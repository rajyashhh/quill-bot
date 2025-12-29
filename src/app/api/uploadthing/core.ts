import { db } from '@/db'
import type { ExtractedImage } from '@prisma/client'
import { getPineconeClient } from '@/lib/pinecone'
import { runOCRInWorker, shouldUseOCR } from '@/lib/pdf-ocr'
import { extractImagesFromPDF } from '@/lib/pdf-image-extractor-cloudinary'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { z } from 'zod'
import { ChapterAwarePineconeIndexer } from '@/lib/chapter-aware-pinecone'
import { ChapterExtractor } from '@/lib/chapter-extractor'
import { createUploadthing, type FileRouter } from 'uploadthing/next'
import { UTApi } from 'uploadthing/server'
import fs from 'fs'
import path from 'path'

const f = createUploadthing()
const utapi = new UTApi()

const middleware = async () => ({}) // public uploads

const onUploadComplete = async ({ metadata, file }: any) => {
  const isFileExist = await db.file.findFirst({ where: { key: file.key } })
  if (isFileExist) return

  const createdFile = await db.file.create({
    data: {
      key: file.key,
      name: file.name,
      subjectId: metadata?.subjectId,
      url:
        (file as any).ufsUrl ||
        (file as any).appUrl ||
        file.url ||
        `https://uploadthing-prod.s3.us-west-2.amazonaws.com/${file.key}`,
      uploadStatus: 'PROCESSING',
    },
  })

  try {
    console.log('[PDF_PROCESSING] Starting to process:', file.name)
    const fileUrl = (file as any).ufsUrl || (file as any).appUrl || file.url
    const response = await fetch(fileUrl)
    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`)
    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    console.log('[PDF_PROCESSING] Parsing PDF with pdf-parse...')
    const pdfParse = require('pdf-parse')
    const pdfData = await pdfParse(buffer)

    const extractedText = pdfData.text
    const totalPages = pdfData.numpages
    console.log('[PDF_PROCESSING] Text length:', extractedText.length)

    // ✅ Run OCR externally if needed
    if (shouldUseOCR(extractedText, totalPages)) {
      console.log('[PDF_PROCESSING] Minimal text extracted — starting OCR...')

      const tempDir = path.resolve(process.cwd(), 'temp')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

      const pdfPath = path.join(tempDir, file.name.replace(/\s+/g, '_'))
      fs.writeFileSync(pdfPath, buffer as any)

      // ✅ Pass fileId to worker for DB + Pinecone updates
      runOCRInWorker(pdfPath, createdFile.id)
      console.log('[PDF_PROCESSING] OCR worker started for:', pdfPath)
    }

    // ✅ Continue with image extraction / indexing
    const extractedImages = await extractImagesFromPDF(buffer)
    console.log('[PDF_PROCESSING] Found', extractedImages.length, 'images')

    const uploadedImages: ExtractedImage[] = []
    for (const [i, image] of extractedImages.entries()) {
      try {
        const fileObj = new File([image.imageBuffer as any], `page-${image.pageNumber}-image-${i + 1}.png`, { type: 'image/png' })
        const uploadedFile = await utapi.uploadFiles(fileObj)
        if (uploadedFile?.data) {
          const dbImage = await db.extractedImage.create({
            data: {
              fileId: createdFile.id,
              pageNumber: image.pageNumber,
              imageUrl: uploadedFile.data.url,
              imageKey: uploadedFile.data.key,
              caption: image.caption || '',
              contextBefore: image.contextBefore,
              contextAfter: image.contextAfter,
              nearbyText: image.nearbyText,
              x: image.boundingBox?.x,
              y: image.boundingBox?.y,
              width: image.boundingBox?.width,
              height: image.boundingBox?.height,
              imageType: image.imageType,
              topics: image.topics,
            },
          })
          uploadedImages.push(dbImage)
        }
      } catch (err) {
        console.error(`[PDF_PROCESSING] Error uploading image ${i + 1}:`, err)
      }
    }

    // Chapter-aware indexing (unchanged)
    const USE_CHAPTER_AWARE_INDEXING = true
    if (USE_CHAPTER_AWARE_INDEXING) {
      const chapterIndexer = new ChapterAwarePineconeIndexer()
      const { chapters, vectors } = await chapterIndexer.indexPDFWithChapters(
        createdFile.id, buffer, 1000, 200
      )

      await db.chapter.deleteMany({ where: { fileId: createdFile.id } })
      for (const chapter of chapters) {
        const extractor = new ChapterExtractor()
        const content = extractor.extractChapterContent(extractedText, chapter)
        const topics = extractor.identifyTopics(content)
        await db.chapter.create({
          data: {
            fileId: createdFile.id,
            chapterNumber: chapter.chapterNumber,
            title: chapter.title,
            content,
            startPage: chapter.startPage,
            endPage: chapter.endPage,
            topics: { create: topics.map((t: any) => ({ ...t })) },
          },
        })
      }
      console.log(`[PDF_PROCESSING] Indexed ${vectors} vectors with chapter awareness`)
    }

    await db.file.update({
      data: { uploadStatus: 'SUCCESS' },
      where: { id: createdFile.id },
    })
  } catch (err: any) {
    console.error('[PDF_PROCESSING_ERROR]', err)
    await db.file.update({
      data: { uploadStatus: 'FAILED' },
      where: { id: createdFile.id },
    })
  }
}

export const ourFileRouter = {
  freePlanUploader: f({ pdf: { maxFileSize: '128MB' } })
    .input(z.object({ subjectId: z.string().optional().nullable(), subfolderId: z.string().optional().nullable() }))
    .middleware(async ({ input }) => {
      console.log("UploadThing Middleware Input:", input);
      return { subjectId: input?.subjectId, subfolderId: input?.subfolderId }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const isFileExist = await db.file.findFirst({ where: { key: file.key } })
      if (isFileExist) return

      const createdFile = await db.file.create({
        data: {
          key: file.key,
          name: file.name,
          subjectId: metadata?.subjectId,
          subfolderId: metadata?.subfolderId,
          url:
            (file as any).ufsUrl ||
            (file as any).appUrl ||
            file.url ||
            `https://uploadthing-prod.s3.us-west-2.amazonaws.com/${file.key}`,
          uploadStatus: 'PROCESSING',
        },
      })

      try {
        console.log('[PDF_PROCESSING] Starting to process:', file.name)
        const fileUrl = (file as any).ufsUrl || (file as any).appUrl || file.url
        const response = await fetch(fileUrl)
        if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`)
        const blob = await response.blob()
        const arrayBuffer = await blob.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        console.log('[PDF_PROCESSING] Parsing PDF with pdf-parse...')
        const pdfParse = require('pdf-parse')
        const pdfData = await pdfParse(buffer)

        const extractedText = pdfData.text
        const totalPages = pdfData.numpages
        console.log('[PDF_PROCESSING] Text length:', extractedText.length)

        // ✅ Run OCR externally if needed
        if (shouldUseOCR(extractedText, totalPages)) {
          console.log('[PDF_PROCESSING] Minimal text extracted — starting OCR...')

          const tempDir = path.resolve(process.cwd(), 'temp')
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

          const pdfPath = path.join(tempDir, file.name.replace(/\s+/g, '_'))
          fs.writeFileSync(pdfPath, buffer as any)

          // ✅ Pass fileId to worker for DB + Pinecone updates
          runOCRInWorker(pdfPath, createdFile.id)
          console.log('[PDF_PROCESSING] OCR worker started for:', pdfPath)
        }

        // ✅ Continue with image extraction / indexing
        const extractedImages = await extractImagesFromPDF(buffer)
        console.log('[PDF_PROCESSING] Found', extractedImages.length, 'images')

        const uploadedImages: ExtractedImage[] = []
        for (const [i, image] of extractedImages.entries()) {
          try {
            const fileObj = new File([image.imageBuffer as any], `page-${image.pageNumber}-image-${i + 1}.png`, { type: 'image/png' })
            const uploadedFile = await utapi.uploadFiles(fileObj)
            if (uploadedFile?.data) {
              const dbImage = await db.extractedImage.create({
                data: {
                  fileId: createdFile.id,
                  pageNumber: image.pageNumber,
                  imageUrl: uploadedFile.data.url,
                  imageKey: uploadedFile.data.key,
                  caption: image.caption || '',
                  contextBefore: image.contextBefore,
                  contextAfter: image.contextAfter,
                  nearbyText: image.nearbyText,
                  x: image.boundingBox?.x,
                  y: image.boundingBox?.y,
                  width: image.boundingBox?.width,
                  height: image.boundingBox?.height,
                  imageType: image.imageType,
                  topics: image.topics,
                },
              })
              uploadedImages.push(dbImage)
            }
          } catch (err) {
            console.error(`[PDF_PROCESSING] Error uploading image ${i + 1}:`, err)
          }
        }

        // Chapter-aware indexing (unchanged)
        const USE_CHAPTER_AWARE_INDEXING = true
        if (USE_CHAPTER_AWARE_INDEXING) {
          const chapterIndexer = new ChapterAwarePineconeIndexer()
          const { chapters, vectors } = await chapterIndexer.indexPDFWithChapters(
            createdFile.id, buffer, 1000, 200
          )

          await db.chapter.deleteMany({ where: { fileId: createdFile.id } })
          for (const chapter of chapters) {
            const extractor = new ChapterExtractor()
            const content = extractor.extractChapterContent(extractedText, chapter)
            const topics = extractor.identifyTopics(content)
            await db.chapter.create({
              data: {
                fileId: createdFile.id,
                chapterNumber: chapter.chapterNumber,
                title: chapter.title,
                content,
                startPage: chapter.startPage,
                endPage: chapter.endPage,
                topics: { create: topics.map((t: any) => ({ ...t })) },
              },
            })
          }
          console.log(`[PDF_PROCESSING] Indexed ${vectors} vectors with chapter awareness`)
        }

        await db.file.update({
          data: { uploadStatus: 'SUCCESS' },
          where: { id: createdFile.id },
        })
      } catch (err: any) {
        console.error('[PDF_PROCESSING_ERROR]', err)
        await db.file.update({
          data: { uploadStatus: 'FAILED' },
          where: { id: createdFile.id },
        })
      }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter