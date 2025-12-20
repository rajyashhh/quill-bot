'use client'

import { trpc } from '@/app/_trpc/client'
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import FeedbackCard from '@/components/FeedbackCard'

interface AnalyticsClientProps {
  fileId: string
}

export default function AnalyticsClient({ fileId }: AnalyticsClientProps) {
  // Fetch data with tRPC (auto-refreshes on navigation)
  const { data: analyticsData, isLoading } = trpc.getFileAnalytics.useQuery(
    { fileId },
    {
      refetchOnWindowFocus: true, // Refetch when user comes back to tab
      refetchOnMount: true, // Refetch when component mounts
    }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (!analyticsData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-zinc-600">No analytics data found</p>
      </div>
    )
  }

  const {
    file,
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
  } = analyticsData

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/dashboard/${fileId}`}
          className={buttonVariants({ variant: 'ghost' })}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Chat
        </Link>
        <h1 className="mt-4 text-3xl font-bold">Analytics Dashboard</h1>
        <p className="text-zinc-600">{file.name}</p>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-zinc-600">Total Messages</h3>
          <p className="text-3xl font-bold mt-2">{totalMessages}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {userMessages} user · {aiMessages} AI
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-zinc-600">Feedback Score</h3>
          <p className="text-3xl font-bold mt-2">
            {thumbsUp + thumbsDown > 0
              ? Math.round((thumbsUp / (thumbsUp + thumbsDown)) * 100)
              : 0}
            %
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            👍 {thumbsUp} · 👎 {thumbsDown}
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border border-zinc-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-zinc-600">Chapter Progress</h3>
            <BookOpen className="h-5 w-5 text-purple-500" />
          </div>
          <p className="text-3xl font-bold">
            {completedChapters}/{totalChapters}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {Number(totalChapters) > 0
              ? Math.round((Number(completedChapters) / Number(totalChapters)) * 100)
              : 0}% complete
          </p>
          <div className="mt-3 h-2 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-500"
              style={{
                width: `${Number(totalChapters) > 0 ? (Number(completedChapters) / Number(totalChapters)) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-zinc-600">Last Active</h3>
          <p className="text-3xl font-bold mt-2">
            {progress?.lastInteraction
              ? new Date(progress.lastInteraction).toLocaleDateString()
              : 'N/A'}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {progress?.isFirstTime ? 'First time user' : 'Returning user'}
          </p>
        </div>
      </div>

      {/* Chapters Overview */}
      {chapters.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-semibold mb-4">Chapters Overview</h2>
          <div className="space-y-3">
            {chapters.map((chapter) => {
              const completedTopics = (progress?.completedTopics || []).filter(
                (t) => t.startsWith(`${chapter.chapterNumber}.`)
              ).length
              const totalTopics = chapter.topics.length

              return (
                <div key={chapter.id} className="border-b pb-3 last:border-b-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium">
                        Chapter {chapter.chapterNumber}: {chapter.title}
                      </h3>
                      <p className="text-sm text-zinc-600">
                        Pages {chapter.startPage}-{chapter.endPage}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {completedTopics}/{totalTopics} topics
                      </p>
                      {totalTopics > 0 && (
                        <p className="text-xs text-zinc-500">
                          {Math.round((completedTopics / totalTopics) * 100)}%
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent Feedback */}
      {feedbackWithContext.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-6">Recent Feedback</h2>
          <div className="space-y-6">
            {feedbackWithContext.slice(0, 10).map((fb) => (
              <FeedbackCard
                key={fb.id}
                feedback={{
                  ...fb,
                  createdAt: new Date(fb.createdAt),
                  Message: { ...fb.Message, createdAt: new Date(fb.Message.createdAt) },
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {feedbackWithContext.length === 0 && (
        <div className="bg-white p-12 rounded-lg shadow text-center">
          <p className="text-zinc-600">No feedback yet. Start chatting to see analytics!</p>
        </div>
      )}
    </div>
  )
}
