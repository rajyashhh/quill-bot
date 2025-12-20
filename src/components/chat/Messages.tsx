import { trpc } from '@/app/_trpc/client'
import { INFINITE_QUERY_LIMIT } from '@/config/infinite-query'
import { Loader2, MessageSquare } from 'lucide-react'
import Skeleton from 'react-loading-skeleton'
import Message from './Message'
import { useContext, useEffect, useRef, useState } from 'react'
import { ChatContext } from './ChatContext'
import { useIntersection } from '@mantine/hooks'
import QuizModal from './QuizModal'

interface MessagesProps {
  fileId: string
}

const Messages = ({ fileId }: MessagesProps) => {
  const { isLoading: isAiThinking, addMessage, isNewSession } = useContext(ChatContext)

  // ============ UPDATED: Get session key from storage ============
  const [sessionKey, setSessionKey] = useState<string>('')

  useEffect(() => {
    // Wait a bit for ChatContext to initialize the key
    const checkKey = () => {
      const key = sessionStorage.getItem('sessionKey')
      if (key) {
        console.log('🔑 [Messages] Using session key:', key)
        setSessionKey(key)
      } else {
        // If no key yet, check again in 100ms
        setTimeout(checkKey, 100)
      }
    }
    checkKey()
  }, [])

  const [showQuiz, setShowQuiz] = useState(false)
  const [quizChapter, setQuizChapter] = useState(1)
  // ============ END UPDATED ============

  // Get learning state - only query when we have a session key
  const { data: learningState, isLoading: isLoadingState, error } = trpc.getLearningState.useQuery(
    {
      fileId,
      sessionKey,
    },
    {
      enabled: !!sessionKey, // ADDED: Only query when sessionKey exists
    }
  )

  // Debug logs for learning state
  useEffect(() => {
    if (!sessionKey) return // Don't log if no key yet

    console.log('=== LEARNING STATE DEBUG ===')
    console.log('📊 Learning State:', learningState)
    console.log('📈 Message Count:', learningState?.messageCount)
    console.log('🎓 Learning Phase:', learningState?.learningPhase)
    console.log('📚 Current Chapter:', learningState?.currentChapter)
    console.log('🔍 Is Loading State:', isLoadingState)
    console.log('❌ Error:', error)
    console.log('========================')
  }, [learningState, isLoadingState, error, sessionKey])

  const { data, isLoading, fetchNextPage } =
    trpc.getFileMessages.useInfiniteQuery(
      {
        fileId,
        limit: INFINITE_QUERY_LIMIT,
      },
      {
        getNextPageParam: (lastPage) =>
          lastPage?.nextCursor,
        keepPreviousData: true,
      }
    )

  const messages = data?.pages.flatMap(
    (page) => page.messages
  )

  const loadingMessage = {
    createdAt: new Date().toISOString(),
    id: 'loading-message',
    isUserMessage: false,
    text: (
      <span className='flex h-full items-center justify-center'>
        <Loader2 className='h-4 w-4 animate-spin' />
      </span>
    ),
  }

  const combinedMessages = [
    ...(isAiThinking ? [loadingMessage] : []),
    ...(messages ?? []),
  ]

  const lastMessageRef = useRef<HTMLDivElement>(null)

  const { ref, entry } = useIntersection({
    root: lastMessageRef.current,
    threshold: 1,
  })

  useEffect(() => {
    if (entry?.isIntersecting) {
      fetchNextPage()
    }
  }, [entry, fetchNextPage])

  // ============ UPDATED: Check if quiz should be shown ============
  useEffect(() => {
    if (!sessionKey || !learningState) return // Wait for data

    console.log('🎯 Quiz Trigger Check:')
    console.log('   - Session Key:', sessionKey)
    console.log('   - Learning Phase:', learningState.learningPhase)
    console.log('   - Message Count:', learningState.messageCount)
    console.log('   - Should Trigger:', learningState.learningPhase === 'quiz-ready')
    console.log('   - Current showQuiz state:', showQuiz)

    if (learningState.learningPhase === 'quiz-ready') {
      console.log('✅ QUIZ TRIGGERED!')
      console.log('   - Setting chapter to:', learningState.currentChapter)
      setQuizChapter(learningState.currentChapter)
      setShowQuiz(true)
    } else {
      console.log('⏳ Waiting for quiz trigger... (count: ' + learningState.messageCount + '/8)')
    }
  }, [learningState, sessionKey]) // Removed showQuiz from deps


  // ============ NEW: Proactive Session Start ============
  const hasStartedSession = useRef(false)

  useEffect(() => {
    // triggers when valid session, loading finished...
    if (sessionKey && !isLoading && messages && !hasStartedSession.current) {
      // Only trigger if:
      // 1. It's a completely new session (new tab/window)
      // 2. OR the history is completely empty (fresh file)
      if (isNewSession || messages.length === 0) {
        console.log('🚀 [Messages] Starting new session automatically!')
        hasStartedSession.current = true
        addMessage('[START_SESSION]')
      }
    }
  }, [sessionKey, isLoading, messages, addMessage, isNewSession])
  // ============ END NEW ============

  // Show loading if no session key yet
  if (!sessionKey) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Loader2 className='h-6 w-6 animate-spin text-zinc-500' />
      </div>
    )
  }

  return (
    <>
      <div className='flex max-h-[calc(100vh-3.5rem-7rem)] border-zinc-200 flex-1 flex-col-reverse gap-4 p-3 overflow-y-auto scrollbar-thumb-blue scrollbar-thumb-rounded scrollbar-track-blue-lighter scrollbar-w-2 scrolling-touch'>
        {combinedMessages && combinedMessages.length > 0 ? (
          combinedMessages.map((message, i) => {
            const isNextMessageSamePerson =
              combinedMessages[i - 1]?.isUserMessage ===
              combinedMessages[i]?.isUserMessage

            if (i === combinedMessages.length - 1) {
              return (
                <Message
                  ref={ref}
                  message={message}
                  isNextMessageSamePerson={
                    isNextMessageSamePerson
                  }
                  key={message.id}
                />
              )
            } else
              return (
                <Message
                  message={message}
                  isNextMessageSamePerson={
                    isNextMessageSamePerson
                  }
                  key={message.id}
                />
              )
          })
        ) : isLoading ? (
          <div className='w-full flex flex-col gap-2'>
            <Skeleton className='h-16' />
            <Skeleton className='h-16' />
            <Skeleton className='h-16' />
            <Skeleton className='h-16' />
          </div>
        ) : (
          <div className='flex-1 flex flex-col items-center justify-center gap-2'>
            <MessageSquare className='h-8 w-8 text-blue-500' />
            <h3 className='font-semibold text-xl'>
              You&apos;re all set!
            </h3>
            <p className='text-zinc-500 text-sm'>
              Ask your first question to get started.
            </p>
          </div>
        )}
      </div>

      {/* Quiz Modal */}
      {showQuiz && (
        <>
          {console.log('🎬 Rendering Quiz Modal for chapter:', quizChapter)}
          <QuizModal
            fileId={fileId}
            chapterNumber={quizChapter}
            sessionKey={sessionKey}
            onClose={() => {
              console.log('❌ Closing quiz modal')
              setShowQuiz(false)
            }}
          />
        </>
      )}
    </>
  )
}

export default Messages
