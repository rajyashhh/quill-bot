import { db } from '@/db'
import { getPineconeClient } from '@/lib/pinecone'
import { extractTextWithOCR, shouldUseOCR } from '@/lib/pdf-ocr'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { createUploadthing, type FileRouter } from 'uploadthing/next'

const f = createUploadthing()

const middleware = async () => {
  // No authentication needed - anyone can upload
  return {}
}

const onUploadComplete = async ({
  metadata,
  file,
}: {
  metadata: Awaited<ReturnType<typeof middleware>>
  file: {
    key: string
    name: string
    url: string
  }
}) => {
  const isFileExist = await db.file.findFirst({
    where: {
      key: file.key,
    },
  })

  if (isFileExist) return

  const createdFile = await db.file.create({
    data: {
      key: file.key,
      name: file.name,
      url: (file as any).ufsUrl || (file as any).appUrl || file.url || `https://uploadthing-prod.s3.us-west-2.amazonaws.com/${file.key}`,
      uploadStatus: 'PROCESSING',
    },
  })

  try {
    console.log('[PDF_PROCESSING] Starting to process:', file.name)
    console.log('[PDF_PROCESSING] Full file object:', JSON.stringify(file, null, 2))
    
    // Use ufsUrl as recommended by UploadThing v9
    const fileUrl = (file as any).ufsUrl || (file as any).appUrl || (file as any).fileUrl || file.url
    console.log('[PDF_PROCESSING] Using URL:', fileUrl)
    
    const response = await fetch(fileUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status}`)
    }

    const blob = await response.blob()
    console.log('[PDF_PROCESSING] Downloaded blob size:', blob.size)

    // Convert blob to buffer for pdf-parse
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Use pdf-parse directly for better compatibility
    console.log('[PDF_PROCESSING] Parsing PDF with pdf-parse...')
    const pdfParse = require('pdf-parse')
    
    let pdfData
    let extractedText: string
    let totalPages: number
    
    try {
      pdfData = await pdfParse(buffer)
      console.log('[PDF_PROCESSING] PDF parsed successfully')
      console.log('[PDF_PROCESSING] Total pages:', pdfData.numpages)
      console.log('[PDF_PROCESSING] Total text length:', pdfData.text.length)
      
      extractedText = pdfData.text
      totalPages = pdfData.numpages
      
      // Check if we need to use OCR
      if (shouldUseOCR(extractedText, totalPages)) {
        console.log('[PDF_PROCESSING] Minimal text extracted, falling back to OCR...')
        try {
          extractedText = await extractTextWithOCR(buffer)
          console.log('[PDF_PROCESSING] OCR extraction complete, new text length:', extractedText.length)
        } catch (ocrError) {
          console.error('[PDF_PROCESSING] OCR failed, using original extraction:', ocrError)
          // Fall back to original extraction if OCR fails
        }
      }
    } catch (parseError) {
      console.error('[PDF_PROCESSING] Error parsing PDF:', parseError)
      throw new Error('Failed to parse PDF content')
    }
    
    // Create documents from the parsed text
    // Split by page breaks if present, otherwise treat as single document
    const pageTexts = extractedText.split(/\f/).filter((text: string) => text.trim().length > 0)
    console.log('[PDF_PROCESSING] Split into', pageTexts.length, 'sections')
    
    const pageLevelDocs = pageTexts.map((text: string, index: number) => ({
      pageContent: text,
      metadata: {
        pageNumber: index + 1,
        totalPages: totalPages,
        source: file.name
      }
    }))
    
    // Split documents into smaller chunks for better retrieval
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ["\n\n", "\n", " ", ""], // Better separators for PDFs
    })
    
    // Process all pages and split them into chunks
    const allSplitDocs: Array<{
      pageContent: string
      metadata: {
        pageNumber: number
        totalPages: number
        source: string
        chunkIndex: number
        totalChunks: number
      }
    }> = []
    
    for (let i = 0; i < pageLevelDocs.length; i++) {
      const pageDoc = pageLevelDocs[i]
      console.log(`[PDF_PROCESSING] Processing page ${i + 1} with ${pageDoc.pageContent.length} characters`)
      
      // Split the page content into chunks
      const chunks = await textSplitter.splitText(pageDoc.pageContent)
      
      // Create document objects for each chunk
      chunks.forEach((chunkText, chunkIndex) => {
        allSplitDocs.push({
          pageContent: chunkText,
          metadata: {
            ...pageDoc.metadata,
            pageNumber: pageDoc.metadata.pageNumber,
            chunkIndex: chunkIndex,
            totalChunks: chunks.length
          }
        })
      })
    }
    
    console.log('[PDF_PROCESSING] Split into chunks:', allSplitDocs.length)
    console.log('[PDF_PROCESSING] First chunk preview:', allSplitDocs[0]?.pageContent.substring(0, 200))
    console.log('[PDF_PROCESSING] First chunk page:', allSplitDocs[0]?.metadata?.pageNumber)

    // vectorize and index entire document
    console.log('[PDF_PROCESSING] Initializing Pinecone client...')
    const pinecone = await getPineconeClient()
    
    // Add debugging for Pinecone configuration
    console.log('[PDF_PROCESSING] Pinecone client initialized')
    
    // Try to list indexes first to verify connection
    try {
      const indexes = await pinecone.listIndexes()
      console.log('[PDF_PROCESSING] Available indexes:', indexes)
    } catch (listError) {
      console.error('[PDF_PROCESSING] Error listing indexes:', listError)
      // Continue anyway as the index might still work
    }
    
    const pineconeIndex = pinecone.Index('quill')
    console.log('[PDF_PROCESSING] Using index: quill')

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    })

    console.log('[PDF_PROCESSING] Creating embeddings and storing in Pinecone...')
    
    // Process documents in batches to avoid issues
    const batchSize = 10
    const vectors = []
    
    for (let i = 0; i < allSplitDocs.length; i += batchSize) {
      const batch = allSplitDocs.slice(i, i + batchSize)
      console.log(`[PDF_PROCESSING] Processing batch ${i / batchSize + 1} of ${Math.ceil(allSplitDocs.length / batchSize)}`)
      
      // Generate embeddings for the batch
      const texts = batch.map(doc => doc.pageContent)
      const embeddingsArray = await embeddings.embedDocuments(texts)
      
      // Prepare vectors for Pinecone
      const batchVectors = batch.map((doc, idx) => ({
        id: `${createdFile.id}-${i + idx}`,
        values: embeddingsArray[idx],
        metadata: {
          text: doc.pageContent.substring(0, 1000), // Limit metadata size
          pageNumber: doc.metadata.pageNumber, // Use the preserved page number
          fileId: createdFile.id,
          chunkIndex: i + idx,
        },
      }))
      
      vectors.push(...batchVectors)
    }
    
    // Upsert vectors to Pinecone in batches
    const upsertBatchSize = 100
    for (let i = 0; i < vectors.length; i += upsertBatchSize) {
      const batch = vectors.slice(i, i + upsertBatchSize)
      console.log(`[PDF_PROCESSING] Upserting batch ${i / upsertBatchSize + 1} of ${Math.ceil(vectors.length / upsertBatchSize)} to Pinecone`)
      
      try {
        console.log(`[PDF_PROCESSING] Upserting ${batch.length} vectors to namespace: ${createdFile.id}`)
        await pineconeIndex.namespace(createdFile.id).upsert(batch)
        console.log(`[PDF_PROCESSING] Successfully upserted batch ${i / upsertBatchSize + 1}`)
      } catch (error) {
        console.error(`[PDF_PROCESSING] Error upserting batch ${i / upsertBatchSize + 1}:`, error)
        console.error('[PDF_PROCESSING] Error details:', {
          namespace: createdFile.id,
          batchSize: batch.length,
          firstVectorId: batch[0]?.id,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        })
        throw error
      }
    }
    
    console.log('[PDF_PROCESSING] Successfully stored in Pinecone')

    await db.file.update({
      data: {
        uploadStatus: 'SUCCESS',
      },
      where: {
        id: createdFile.id,
      },
    })
  } catch (err: any) {
    console.error('[PDF_PROCESSING_ERROR]', err)
    console.error('[PDF_PROCESSING_ERROR_DETAILS]', {
      message: err.message,
      stack: err.stack,
      response: err.response?.data,
    })
    await db.file.update({
      data: {
        uploadStatus: 'FAILED',
      },
      where: {
        id: createdFile.id,
      },
    })
    throw err // Re-throw to see the error in UploadThing
  }
}

export const ourFileRouter = {
  freePlanUploader: f({ pdf: { maxFileSize: '128MB' } })
    .middleware(middleware)
    .onUploadComplete(onUploadComplete),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter
