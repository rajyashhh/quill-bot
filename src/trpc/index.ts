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
  getUserFiles: publicProcedure
    .input(z.object({
      subjectId: z.string().nullable().optional(),
      subfolderId: z.string().nullable().optional()
    }).optional())
    .query(async ({ input }) => {
      const whereClause: any = {}

      if (input?.subjectId !== undefined) {
        whereClause.subjectId = input.subjectId
      }

      if (input?.subfolderId !== undefined) {
        whereClause.subfolderId = input.subfolderId
      }

      // If filtering by subject but NOT subfolder, we generally only want root files
      // BUT if subfolderId is explicitly null, we want root files.
      // If subfolderId is undefined, maybe we want all files (recursive)? 
      // For now, let's stick to strict filtering if provided.

      return await db.file.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc',
        },
      })
    }),

  createSubject: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return await db.subject.create({
        data: {
          name: input.name,
        },
      })
    }),

  getSubjects: publicProcedure.query(async () => {
    return await db.subject.findMany({
      include: {
        _count: {
          select: { files: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })
  }),

  getSubject: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const subject = await db.subject.findUnique({
        where: { id: input.id },
      })
      if (!subject) throw new TRPCError({ code: 'NOT_FOUND' })
      return subject
    }),

  createSubfolder: publicProcedure
    .input(z.object({ name: z.string().min(1), subjectId: z.string() }))
    .mutation(async ({ input }) => {
      return await db.subfolder.create({
        data: {
          name: input.name,
          subjectId: input.subjectId,
        },
      })
    }),

  getSubfolders: publicProcedure
    .input(z.object({ subjectId: z.string() }))
    .query(async ({ input }) => {
      return await db.subfolder.findMany({
        where: { subjectId: input.subjectId },
        include: {
          _count: {
            select: { files: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })
    }),

  getSubfolder: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const subfolder = await db.subfolder.findUnique({
        where: { id: input.id },
      })
      if (!subfolder) throw new TRPCError({ code: 'NOT_FOUND' })
      return subfolder
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
        // Attempt recovery from StudentProgress
        const progress = await db.studentProgress.findFirst({
          where: { fileId: input.fileId }
        })

        console.log('🆕 Creating new learning state', progress ? '(Recovered)' : '(Fresh)')

        state = await db.learningState.create({
          data: {
            fileId: input.fileId,
            sessionKey: input.sessionKey,
            currentChapter: progress?.currentChapter ?? 1,
            currentTopic: progress?.currentTopic ?? 1,
            learningPhase: progress ? 'learning' : 'introduction',
            messageCount: 0,
            chaptersCompleted: progress?.completedTopics ? [] : [], // We don't track chapter completion in StudentProgress explicitly, just topics, so safe default
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
      retry: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const { fileId, chapterNumber } = input

      console.log(`📝 [tRPC] Checking for existing quiz: Chapter ${chapterNumber}`)

      // Check if quiz already exists
      // If retry is true, we skip this check to force new generation
      if (!input.retry) {
        const existingQuiz = await db.quizQuestion.findMany({
          where: { fileId, chapterNumber },
          take: 10,
        })

        if (existingQuiz.length >= 10) {
          console.log(`✅ [tRPC] Found ${existingQuiz.length} existing questions`)
          return existingQuiz
        }
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
      // STRICT GATEKEEPING: Must score 6/10 to pass
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

      if (passed) {
        // Unlock next chapter
        await db.learningState.update({
          where: { sessionKey },
          data: {
            chaptersCompleted: { push: chapterNumber }, // Append to array
            quizzesPassed: { push: chapterNumber },
            currentChapter: chapterNumber + 1,
            currentTopic: 1,
            learningPhase: 'introduction',
            needsReview: false,
            messageCount: 0,
          },
        })

        // Also sync StudentProgress for persistence
        await db.studentProgress.updateMany({
          where: { fileId },
          data: {
            currentChapter: chapterNumber + 1,
            currentTopic: 1,
          }
        })
      } else {
        // Block progress, force review
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

  // Mark topic as complete and move to next
  completeTopic: publicProcedure
    .input(z.object({
      fileId: z.string(),
      sessionKey: z.string(),
      chapterNumber: z.number(),
      topicNumber: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { fileId, sessionKey, chapterNumber, topicNumber } = input
      const topicIdentifier = `${chapterNumber}.${topicNumber}`

      // 1. Update StudentProgress (Analytics)
      const progress = await db.studentProgress.findUnique({
        where: { fileId },
      })

      if (progress) {
        const completedTopics = new Set(progress.completedTopics)
        completedTopics.add(topicIdentifier)

        const nextTopic = topicNumber + 1

        await db.studentProgress.update({
          where: { fileId },
          data: {
            completedTopics: Array.from(completedTopics),
            lastInteraction: new Date(),
            // Sync pointer
            currentChapter: chapterNumber,
            currentTopic: nextTopic,
          },
        })
      } else {
        await db.studentProgress.create({
          data: {
            fileId,
            completedTopics: [topicIdentifier],
            currentChapter: chapterNumber,
            currentTopic: topicNumber + 1,
          },
        })
      }

      // Check if this was the last topic of the chapter
      const chapter = await db.chapter.findFirst({
        where: { fileId, chapterNumber },
        include: { topics: true },
      })

      if (chapter) {
        const totalTopics = chapter.topics.length

        // Only trigger quiz if:
        // 1. It is the last topic
        // 2. The chapter actually HAS topics (avoid weird states)
        if (totalTopics > 0 && topicNumber >= totalTopics) {
          // It's the last topic! Trigger quiz phase
          await db.learningState.update({
            where: { sessionKey },
            data: {
              learningPhase: 'quiz-ready',
              messageCount: 0,
              lastInteraction: new Date(),
            }
          })
          return { success: true, quizReady: true }
        }
      }

      // 2. Update LearningState (Session) - Move to next topic
      await db.learningState.update({
        where: { sessionKey },
        data: {
          currentTopic: topicNumber + 1,
          messageCount: 0,
          lastInteraction: new Date(),
        },
      })

      return { success: true, quizReady: false }
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
  // createOrGetSession: publicProcedure
  //   .input(z.object({
  //     fileId: z.string(),
  //     sessionKey: z.string()
  //   }))
  //   .mutation(async ({ input }) => {
  //     let session = await db.learningSession.findUnique({
  //       where: { sessionKey: input.sessionKey }
  //     })

  //     if (!session) {
  //       session = await db.learningSession.create({
  //         data: {
  //           fileId: input.fileId,
  //           sessionKey: input.sessionKey,
  //           state: 'greeting',
  //           progress: {}
  //         }
  //       })
  //     }

  //     return session
  //   }),

  // updateSessionState: publicProcedure
  //   .input(z.object({
  //     sessionId: z.string(),
  //     state: z.string(),
  //     currentChapterId: z.string().optional(),
  //     currentTopicId: z.string().optional(),
  //     progress: z.any().optional()
  //   }))
  //   .mutation(async ({ input }) => {
  //     const session = await db.learningSession.update({
  //       where: { id: input.sessionId },
  //       data: {
  //         state: input.state,
  //         currentChapterId: input.currentChapterId,
  //         currentTopicId: input.currentTopicId,
  //         progress: input.progress || undefined
  //       }
  //     })

  //     return session
  //   }),

  // getSession: publicProcedure
  //   .input(z.object({ sessionKey: z.string() }))
  //   .query(async ({ input }) => {
  //     const session = await db.learningSession.findUnique({
  //       where: { sessionKey: input.sessionKey }
  //     })

  //     return session
  //   }),
})

export type AppRouter = typeof appRouter
