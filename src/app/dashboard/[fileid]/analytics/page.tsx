import { db } from '@/db'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

interface AnalyticsPageProps {
  params: {
    fileid: string
  }
}

const AnalyticsPage = async ({ params }: AnalyticsPageProps) => {
  const { fileid } = params
  
  // Fetch file and related analytics data
  const file = await db.file.findFirst({
    where: { id: fileid },
  })
  
  if (!file) notFound()
  
  // Fetch message analytics
  const messages = await db.message.findMany({
    where: { fileId: fileid },
    orderBy: { createdAt: 'desc' },
  })
  
  // Fetch message feedback
  const feedback = await db.messageFeedback.findMany({
    where: { fileId: fileid },
    include: {
      Message: true,
    },
  })
  
  // Fetch student progress
  const progress = await db.studentProgress.findUnique({
    where: { fileId: fileid },
  })
  
  // Fetch chapters
  const chapters = await db.chapter.findMany({
    where: { fileId: fileid },
    include: {
      topics: true,
    },
    orderBy: {
      chapterNumber: 'asc',
    },
  })
  
  // Calculate statistics
  const totalMessages = messages.length
  const userMessages = messages.filter(m => m.isUserMessage).length
  const aiMessages = messages.filter(m => !m.isUserMessage).length
  const thumbsUp = feedback.filter(f => f.feedbackType === 'THUMBS_UP').length
  const thumbsDown = feedback.filter(f => f.feedbackType === 'THUMBS_DOWN').length
  const completedChapters = progress?.completedChapters || 0
  const totalChapters = chapters.length

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/dashboard/${fileid}`}
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

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-sm font-medium text-zinc-600">Chapter Progress</h3>
          <p className="text-3xl font-bold mt-2">
            {completedChapters}/{totalChapters}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {totalChapters > 0
              ? Math.round((completedChapters / totalChapters) * 100)
              : 0}
            % complete
          </p>
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
      {feedback.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Recent Feedback</h2>
          <div className="space-y-4">
            {feedback.slice(0, 5).map((fb) => (
              <div key={fb.id} className="border-b pb-3 last:border-b-0">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">
                    {fb.feedbackType === 'THUMBS_UP' ? '👍' : '👎'}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-zinc-600">
                      {fb.feedbackCategory || 'No category'}
                    </p>
                    {fb.feedbackReason && (
                      <p className="text-sm text-zinc-700 mt-1">{fb.feedbackReason}</p>
                    )}
                    <p className="text-xs text-zinc-500 mt-1">
                      {new Date(fb.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalyticsPage
