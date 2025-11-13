import { db } from '@/db'
import { getPineconeClient } from '@/lib/pinecone'
import { SendMessageValidator } from '@/lib/validators/SendMessageValidator'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { NextRequest } from 'next/server'

import { StreamingTextResponse } from 'ai'
import { OpenAI } from 'openai'

export const POST = async (req: NextRequest) => {
  try {
    // endpoint for asking a question to a pdf file

    const body = await req.json()

  const { fileId, message } =
    SendMessageValidator.parse(body)

  const file = await db.file.findFirst({
    where: {
      id: fileId,
    },
  })
  
  // Fetch chapters separately to avoid TypeScript errors
  const chapters = await db.chapter.findMany({
    where: {
      fileId: fileId,
    },
    include: {
      topics: true
    },
    orderBy: {
      chapterNumber: 'asc'
    }
  })

  if (!file)
    return new Response('Not found', { status: 404 })

  await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      fileId,
    },
  })

  // Check if the query is asking about chapters/topics
  const isChapterQuery = /chapter|topic|section|unit|module/i.test(message)
  const chapterNumberMatch = message.match(/chapter\s*(\d+)/i)
  
  let chapterInfo = ''
  if (isChapterQuery && chapters.length > 0) {
    if (chapterNumberMatch) {
      // User is asking about a specific chapter
      const chapterNum = parseInt(chapterNumberMatch[1])
      const chapter = chapters.find((ch: { chapterNumber: number }) => ch.chapterNumber === chapterNum)
      if (chapter) {
        chapterInfo = `\n\nChapter ${chapter.chapterNumber}: ${chapter.title}\n`
        chapterInfo += `Pages: ${chapter.startPage}-${chapter.endPage}\n`
        if (chapter.topics.length > 0) {
          chapterInfo += `\nTopics in this chapter:\n`
          chapter.topics.forEach((topic: { topicNumber: any; title: any; estimatedTime: any }) => {
            chapterInfo += `- Topic ${topic.topicNumber}: ${topic.title} (Est. ${topic.estimatedTime} mins)\n`
          })
        }
      }
    } else {
      // User is asking about chapters in general
      chapterInfo = `\n\nAvailable Chapters:\n`
      chapters.forEach((chapter: { chapterNumber: any; title: any; startPage: any; endPage: any }) => {
        chapterInfo += `- Chapter ${chapter.chapterNumber}: ${chapter.title} (Pages ${chapter.startPage}-${chapter.endPage})\n`
      })
    }
  }

  // 1: vectorize message
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  })

  const pinecone = await getPineconeClient()
  const pineconeIndex = pinecone.Index('quill')

  // Create embedding for the query
  const queryEmbedding = await embeddings.embedQuery(message)

  // Query Pinecone directly
  console.log('[CHAT] Querying Pinecone with namespace:', file.id)
  const queryResponse = await pineconeIndex
    .namespace(file.id)
    .query({
      vector: queryEmbedding,
      topK: 10, // Increased from 4 to get more context
      includeValues: false,
      includeMetadata: true,
    })

  console.log('[CHAT] Query response:', JSON.stringify(queryResponse, null, 2))

  // Extract the text content from the results with page numbers and image references
  const results = queryResponse.matches?.map((match) => ({
    pageContent: match.metadata?.text || '',
    metadata: {
      pageNumber: match.metadata?.pageNumber,
      score: match.score,
      imageIds: match.metadata?.imageIds || [],
      referencedImageIds: match.metadata?.referencedImageIds || [],
      hasImages: match.metadata?.hasImages || false,
      source: match.metadata?.source, // Track if this is OCR content
    },
  })) || []

  console.log('[CHAT] Extracted results:', results.length, 'documents')
  
  // Check if we got any OCR results from Pinecone
  const ocrResults = results.filter(r => r.metadata.source === 'OCR')
  const hasOcrResults = ocrResults.length > 0
  const hasGoodOcrContent = ocrResults.some(r => r.pageContent.length > 50)
  
  console.log('[CHAT] OCR results from Pinecone:', ocrResults.length)
  console.log('[CHAT] Has good OCR content:', hasGoodOcrContent)
  
  // If file used OCR but we have poor/no results, add full OCR text as fallback
  let ocrContext = ''
  if (file.usedOCR && file.ocrText) {
    if (!hasOcrResults || !hasGoodOcrContent) {
      console.log('[CHAT] Adding full OCR text from database (', file.ocrText.length, 'chars)')
      // Use more of the OCR text if we have no good results at all
      const maxLength = hasOcrResults ? 3000 : 8000
      ocrContext = `\n\n---------------- OCR EXTRACTED TEXT ----------------\n${file.ocrText.substring(0, maxLength)}\n`
    } else {
      console.log('[CHAT] Using OCR results from Pinecone')
    }
  }
  
  // Collect all unique image IDs from the results
  const allImageIds = new Set<string>()
  results.forEach(result => {
    if (result.metadata.imageIds && Array.isArray(result.metadata.imageIds)) {
      result.metadata.imageIds.forEach((id: string) => allImageIds.add(id))
    }
    if (result.metadata.referencedImageIds && Array.isArray(result.metadata.referencedImageIds)) {
      result.metadata.referencedImageIds.forEach((id: string) => allImageIds.add(id))
    }
  })
  
  // Fetch image data if any images are referenced
  let images: any[] = []
  if (allImageIds.size > 0) {
    console.log('[CHAT] Fetching', allImageIds.size, 'images')
    images = await db.extractedImage.findMany({
      where: {
        id: {
          in: Array.from(allImageIds)
        }
      },
      select: {
        id: true,
        imageUrl: true,
        caption: true,
        pageNumber: true,
        imageType: true,
        topics: true,
      }
    })
    console.log('[CHAT] Found', images.length, 'images')
  }
  
  // Format context with page numbers
  const contextWithPages = results
    .filter(r => r.pageContent.trim().length > 0) // Filter out empty content
    .map((r) => {
      const pageNum = r.metadata.pageNumber ? `[Page ${r.metadata.pageNumber}]` : '[Page unknown]'
      const sourceTag = r.metadata.source === 'OCR' ? ' [OCR]' : ''
      return `${pageNum}${sourceTag} ${r.pageContent}`
    }).join('\n\n')

  const prevMessages = await db.message.findMany({
    where: {
      fileId,
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: 6,
  })

  const formattedPrevMessages = prevMessages.map((msg) => ({
    role: msg.isUserMessage
      ? ('user' as const)
      : ('assistant' as const),
    content: msg.text,
  }))

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
    stream: true,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant that answers questions based on the provided PDF context. Always cite the page numbers where you found the information. When relevant images are available, reference them in your answer (e.g., "As shown in Figure 3.1 on page 45..."). When chapter information is provided, use it to give structured answers about the document organization. Use the following pieces of context to answer the users question accurately and comprehensively. Format your response in markdown when appropriate. Paraphrase the content naturally while maintaining technical accuracy.',
      },
      {
        role: 'user',
        content: `Answer the following question based on the provided context. Each piece of context is prefixed with its page number in square brackets like [Page 123]. Some context may be marked as [OCR], which means it was extracted using Optical Character Recognition from scanned pages. When you use information from the context, ALWAYS cite the page number(s) where you found it. If the answer cannot be found in the context, say "I cannot find information about that in the provided PDF."
        
  \n----------------\n
  
  PREVIOUS CONVERSATION:
  ${formattedPrevMessages.map((message) => {
    if (message.role === 'user')
      return `User: ${message.content}\n`
    return `Assistant: ${message.content}\n`
  })}
  
  \n----------------\n
  
  ${chapterInfo ? `CHAPTER INFORMATION:${chapterInfo}\n----------------\n` : ''}
  
  CONTEXT WITH PAGE NUMBERS:
  ${contextWithPages}
  ${ocrContext}
  
  ${images.length > 0 ? `RELEVANT IMAGES:
  ${images.map(img => `- ${img.caption || `Image on page ${img.pageNumber}`} (Page ${img.pageNumber}, Type: ${img.imageType || 'diagram'})`).join('\n')}
  
  Note: The actual images will be displayed to the user alongside your response. Reference them naturally in your answer when relevant.
  ` : ''}
  
  USER INPUT: ${message}`,
      },
    ],
  })

  // Convert the response into a readable stream
  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''
      
      try {
        for await (const chunk of response) {
          const content = chunk.choices[0]?.delta?.content || ''
          fullResponse += content
          
          // Encode and send the chunk
          const bytes = new TextEncoder().encode(content)
          controller.enqueue(bytes)
        }
        
        // Save the complete message after streaming is done
        await db.message.create({
          data: {
            text: fullResponse,
            isUserMessage: false,
            fileId,
          },
        })
      } catch (error) {
        controller.error(error)
      } finally {
        controller.close()
      }
    },
  })

  // Return both the stream and images data
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Images-Data': JSON.stringify(images), // Send images data in header
    },
  })
  } catch (error) {
    console.error('[MESSAGE_ERROR]', error)
    return new Response('Internal error', { status: 500 })
  }
}
