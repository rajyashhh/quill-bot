import {
  privateProcedure,
  publicProcedure,
  router,
} from './trpc'
import { TRPCError } from '@trpc/server'
import { db } from '@/db'
import { z } from 'zod'
import { INFINITE_QUERY_LIMIT } from '@/config/infinite-query'
import { ChapterExtractor } from '@/lib/chapter-extractor'

export const appRouter = router({
  getUserFiles: publicProcedure.query(async () => {
    return await db.file.findMany()
  }),

  getFileMessages: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).nullish(),
        cursor: z.string().nullish(),
        fileId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { fileId, cursor } = input
      const limit = input.limit ?? INFINITE_QUERY_LIMIT

      const file = await db.file.findFirst({
        where: {
          id: fileId,
        },
      })

      if (!file) throw new TRPCError({ code: 'NOT_FOUND' })

      const messages = await db.message.findMany({
        take: limit + 1,
        where: {
          fileId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          isUserMessage: true,
          createdAt: true,
          text: true,
        },
      })

      let nextCursor: typeof cursor | undefined = undefined
      if (messages.length > limit) {
        const nextItem = messages.pop()
        nextCursor = nextItem?.id
      }

      return {
        messages,
        nextCursor,
      }
    }),

  getFileUploadStatus: publicProcedure
    .input(z.object({ fileId: z.string() }))
    .query(async ({ input }) => {
      const file = await db.file.findFirst({
        where: {
          id: input.fileId,
        },
      })

      if (!file) return { status: 'PENDING' as const }

      return { status: file.uploadStatus }
    }),

  getFile: publicProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      const file = await db.file.findFirst({
        where: {
          key: input.key,
        },
      })

      if (!file) throw new TRPCError({ code: 'NOT_FOUND' })

      return file
    }),

  deleteFile: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const file = await db.file.findFirst({
        where: {
          id: input.id,
        },
      })

      if (!file) throw new TRPCError({ code: 'NOT_FOUND' })

      await db.file.delete({
        where: {
          id: input.id,
        },
      })

      return file
    }),

  // Chapter-related endpoints
  extractChapters: publicProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input }) => {
      const file = await db.file.findFirst({
        where: { id: input.fileId },
        include: { chapters: true }
      })

      if (!file) throw new TRPCError({ code: 'NOT_FOUND' })

      // If chapters already extracted, return them
      if (file.chapters.length > 0) {
        return file.chapters
      }

      // Download and extract chapters
      const response = await fetch(file.url)
      if (!response.ok) {
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to download PDF'
        })
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const extractor = new ChapterExtractor()
      const { chapters, fullText } = await extractor.extractChaptersFromPDF(buffer)

      // Save chapters to database
      const savedChapters = await Promise.all(
        chapters.map(async (chapter) => {
          const content = extractor.extractChapterContent(fullText, chapter)
          const topics = extractor.identifyTopics(content)

          const savedChapter = await db.chapter.create({
            data: {
              fileId: file.id,
              chapterNumber: chapter.chapterNumber,
              title: chapter.title,
              content: content,
              startPage: chapter.startPage,
              endPage: chapter.endPage,
              topics: {
                create: topics.map(topic => ({
                  topicNumber: topic.topicNumber,
                  title: topic.title,
                  content: topic.content,
                  estimatedTime: topic.estimatedTime
                }))
              }
            },
            include: { topics: true }
          })

          return savedChapter
        })
      )

      return savedChapters
    }),

  getChapters: publicProcedure
    .input(z.object({ fileId: z.string() }))
    .query(async ({ input }) => {
      const chapters = await db.chapter.findMany({
        where: { fileId: input.fileId },
        include: { topics: true },
        orderBy: { chapterNumber: 'asc' }
      })

      return chapters
    }),

  getChapter: publicProcedure
    .input(z.object({ chapterId: z.string() }))
    .query(async ({ input }) => {
      const chapter = await db.chapter.findUnique({
        where: { id: input.chapterId },
        include: { topics: true }
      })

      if (!chapter) throw new TRPCError({ code: 'NOT_FOUND' })

      return chapter
    }),

  // Learning session endpoints
  createOrGetSession: publicProcedure
    .input(z.object({ 
      fileId: z.string(),
      sessionKey: z.string()
    }))
    .mutation(async ({ input }) => {
      // Try to find existing session
      let session = await db.learningSession.findUnique({
        where: { sessionKey: input.sessionKey }
      })

      // Create new session if doesn't exist
      if (!session) {
        session = await db.learningSession.create({
          data: {
            fileId: input.fileId,
            sessionKey: input.sessionKey,
            state: 'greeting',
            progress: {}
          }
        })
      }

      return session
    }),

  updateSessionState: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      state: z.string(),
      currentChapterId: z.string().optional(),
      currentTopicId: z.string().optional(),
      progress: z.any().optional()
    }))
    .mutation(async ({ input }) => {
      const session = await db.learningSession.update({
        where: { id: input.sessionId },
        data: {
          state: input.state,
          currentChapterId: input.currentChapterId,
          currentTopicId: input.currentTopicId,
          progress: input.progress || undefined
        }
      })

      return session
    }),

  getSession: publicProcedure
    .input(z.object({ sessionKey: z.string() }))
    .query(async ({ input }) => {
      const session = await db.learningSession.findUnique({
        where: { sessionKey: input.sessionKey }
      })

      return session
    }),
})

export type AppRouter = typeof appRouter
