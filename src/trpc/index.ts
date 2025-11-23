import {
  privateProcedure,
  publicProcedure,
  router,
} from './trpc'
import { TRPCError } from '@trpc/server'
import { db } from '@/db'
import { z } from 'zod'
import { generateChapterQuiz as generateQuiz } from '@/lib/quiz-generator'
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

  // Feedback endpoints
  submitMessageFeedback: publicProcedure
    .input(
      z.object({
        messageId: z.string(),
        feedbackType: z.enum(['THUMBS_UP', 'THUMBS_DOWN']),
        feedbackReason: z.string().optional(),
        feedbackCategory: z.enum([
          'TOO_COMPLEX',
          'INCORRECT_INFO',
          'MISSING_CONTEXT',
          'OFF_TOPIC',
          'OTHER'
        ]).optional(),
        correctedResponse: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const message = await db.message.findUnique({
        where: { id: input.messageId },
      })

      if (!message) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Message not found',
        })
      }

      const existingFeedback = await db.messageFeedback.findUnique({
        where: { messageId: input.messageId },
      })

      if (existingFeedback) {
        const updatedFeedback = await db.messageFeedback.update({
          where: { messageId: input.messageId },
          data: {
            feedbackType: input.feedbackType,
            feedbackReason: input.feedbackReason,
            feedbackCategory: input.feedbackCategory,
            correctedResponse: input.correctedResponse,
            updatedAt: new Date(),
          },
        })

        return updatedFeedback
      }

      const feedback = await db.messageFeedback.create({
        data: {
          messageId: input.messageId,
          fileId: message.fileId!,
          feedbackType: input.feedbackType,
          feedbackReason: input.feedbackReason,
          feedbackCategory: input.feedbackCategory,
          correctedResponse: input.correctedResponse,
        },
      })

      return feedback
    }),

  updateMessageFeedback: publicProcedure
    .input(
      z.object({
        feedbackId: z.string(),
        correctedResponse: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const feedback = await db.messageFeedback.findUnique({
        where: { id: input.feedbackId },
      })

      if (!feedback) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Feedback not found',
        })
      }

      const updated = await db.messageFeedback.update({
        where: { id: input.feedbackId },
        data: {
          correctedResponse: input.correctedResponse,
          updatedAt: new Date(),
        },
      })

      return updated
    }),

  // FIXED: Get or create learning state with logging
  getLearningState: publicProcedure
    .input(z.object({ 
      fileId: z.string(),
      sessionKey: z.string() 
    }))
    .query(async ({ input }) => {
      console.log('🔍 getLearningState called:', input)
      
      let state = await db.learningState.findUnique({
        where: { sessionKey: input.sessionKey },
      })

      console.log('📊 Found state:', state)

      if (!state) {
        console.log('🆕 Creating new learning state')
        state = await db.learningState.create({
          data: {
            fileId: input.fileId,
            sessionKey: input.sessionKey,
            currentChapter: 1,
            currentTopic: 1,
            learningPhase: 'introduction',
            messageCount: 0, // ADDED: Initialize to 0
          },
        })
        console.log('✅ Created state:', state)
      }

      return state
    }),

  // Generate quiz for current chapter
// Generate quiz for current chapter
generateChapterQuiz: publicProcedure
  .input(z.object({
    fileId: z.string(),
    chapterNumber: z.number(),
  }))
  .query(async ({ input }) => {
    const { fileId, chapterNumber } = input

    console.log(`📝 [tRPC] Checking for existing quiz: Chapter ${chapterNumber}`)

    // Check if quiz already exists
    const existingQuiz = await db.quizQuestion.findMany({
      where: { fileId, chapterNumber },
      take: 10,
    })

    if (existingQuiz.length >= 10) {
      console.log(`✅ [tRPC] Found ${existingQuiz.length} existing questions`)
      return existingQuiz
    }

    console.log(`🔨 [tRPC] No existing quiz found, generating new one...`)

    // Get chapter content
    const chapter = await db.chapter.findFirst({
      where: { fileId, chapterNumber },
      include: { topics: true },
    })

    if (!chapter) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Chapter not found' })
    }

    // Generate quiz with AI
    const topics = chapter.topics.map(t => t.title)
    
    try {
      const newQuestions = await generateQuiz({
        fileId,
        chapterNumber,
        chapterContent: chapter.content,
        chapterTitle: chapter.title,
        topics,
        count: 10,
      })

      console.log(`✅ [tRPC] Successfully generated ${newQuestions.length} questions`)
      return newQuestions
    } catch (error) {
      console.error('❌ [tRPC] Quiz generation failed:', error)
      throw new TRPCError({ 
        code: 'INTERNAL_SERVER_ERROR', 
        message: 'Failed to generate quiz questions' 
      })
    }
  }),


  // Submit quiz answers
  submitQuizAnswers: publicProcedure
    .input(z.object({
      fileId: z.string(),
      chapterNumber: z.number(),
      sessionKey: z.string(),
      answers: z.array(z.object({
        questionId: z.string(),
        selectedAnswer: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const { fileId, chapterNumber, sessionKey, answers } = input

      const questions = await db.quizQuestion.findMany({
        where: {
          fileId,
          chapterNumber,
          id: { in: answers.map(a => a.questionId) },
        },
      })

      const gradedAnswers = answers.map(answer => {
        const question = questions.find(q => q.id === answer.questionId)
        const isCorrect = question?.correctAnswer === answer.selectedAnswer
        
        return {
          questionId: answer.questionId,
          selectedAnswer: answer.selectedAnswer,
          correctAnswer: question?.correctAnswer,
          isCorrect,
          topicCovered: question?.topicCovered,
        }
      })

      const score = gradedAnswers.filter(a => a.isCorrect).length
      const passed = score >= 6

      const weakTopics = gradedAnswers
        .filter(a => !a.isCorrect)
        .map(a => a.topicCovered)
        .filter((topic, index, self) => topic && self.indexOf(topic) === index) as string[]

      const attempt = await db.quizAttempt.create({
        data: {
          fileId,
          chapterNumber,
          sessionKey,
          score,
          totalQuestions: answers.length,
          answers: gradedAnswers,
          weakTopics,
          passed,
        },
      })

      const learningState = await db.learningState.findUnique({
        where: { sessionKey },
      })

      if (passed) {
        await db.learningState.update({
          where: { sessionKey },
          data: {
            chaptersCompleted: [...(learningState?.chaptersCompleted || []), chapterNumber],
            quizzesPassed: [...(learningState?.quizzesPassed || []), chapterNumber],
            currentChapter: chapterNumber + 1,
            currentTopic: 1,
            learningPhase: 'introduction',
            needsReview: false,
            messageCount: 0,
          },
        })
      } else {
        await db.learningState.update({
          where: { sessionKey },
          data: {
            learningPhase: 'review',
            needsReview: true,
            reviewTopics: weakTopics,
          },
        })
      }

      return {
        score,
        totalQuestions: answers.length,
        passed,
        weakTopics,
        gradedAnswers,
        attempt,
      }
    }),

  // Update learning phase
  updateLearningPhase: publicProcedure
    .input(z.object({
      sessionKey: z.string(),
      phase: z.string(),
      incrementMessageCount: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const updateData: any = {
        learningPhase: input.phase,
        lastInteraction: new Date(),
      }

      if (input.incrementMessageCount) {
        const state = await db.learningState.findUnique({
          where: { sessionKey: input.sessionKey },
        })
        updateData.messageCount = (state?.messageCount || 0) + 1
      }

      return await db.learningState.update({
        where: { sessionKey: input.sessionKey },
        data: updateData,
      })
    }),

  // Get file analytics
  getFileAnalytics: publicProcedure
    .input(z.object({ fileId: z.string() }))
    .query(async ({ input }) => {
      const { fileId } = input

      const file = await db.file.findFirst({
        where: { id: fileId },
      })

      if (!file) throw new TRPCError({ code: 'NOT_FOUND' })

      const messages = await db.message.findMany({
        where: { fileId },
        orderBy: { createdAt: 'desc' },
      })

      const feedback = await db.messageFeedback.findMany({
        where: { fileId },
        include: {
          Message: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      const feedbackWithContext = await Promise.all(
        feedback.map(async (fb) => {
          const userMessage = await db.message.findFirst({
            where: {
              fileId,
              isUserMessage: true,
              createdAt: {
                lt: fb.Message.createdAt,
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          })

          return {
            ...fb,
            userQuestion: userMessage?.text || 'Question not found',
          }
        })
      )

      const progress = await db.studentProgress.findUnique({
        where: { fileId },
      })

      const chapters = await db.chapter.findMany({
        where: { fileId },
        include: {
          topics: true,
        },
        orderBy: {
          chapterNumber: 'asc',
        },
      })

      const totalMessages = messages.length
      const userMessages = messages.filter(m => m.isUserMessage).length
      const aiMessages = messages.filter(m => !m.isUserMessage).length
      const thumbsUp = feedback.filter(f => f.feedbackType === 'THUMBS_UP').length
      const thumbsDown = feedback.filter(f => f.feedbackType === 'THUMBS_DOWN').length
      const completedChapters = progress?.completedChapters || 0
      const totalChapters = chapters.length

      return {
        file,
        messages,
        feedbackWithContext,
        progress,
        chapters,
        totalMessages,
        userMessages,
        aiMessages,
        thumbsUp,
        thumbsDown,
        completedChapters,
        totalChapters,
      }
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

      if (file.chapters.length > 0) {
        return file.chapters
      }

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

  // Learning session endpoints (legacy - can be removed if not used)
  createOrGetSession: publicProcedure
    .input(z.object({ 
      fileId: z.string(),
      sessionKey: z.string()
    }))
    .mutation(async ({ input }) => {
      let session = await db.learningSession.findUnique({
        where: { sessionKey: input.sessionKey }
      })

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
