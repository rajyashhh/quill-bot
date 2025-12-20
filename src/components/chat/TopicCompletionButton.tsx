'use client'

import { trpc } from '@/app/_trpc/client'
import { Button } from '../ui/button'
import { CheckCircle, Loader2, ArrowRight } from 'lucide-react'
import { useContext, useEffect } from 'react'
import { ChatContext } from './ChatContext'
import { useToast } from '../ui/use-toast'

interface TopicCompletionButtonProps {
    fileId: string
}

export default function TopicCompletionButton({ fileId }: TopicCompletionButtonProps) {
    const { sessionKey, isSmartCompletionDetected, resetSmartCompletion } = useContext(ChatContext)
    const { toast } = useToast()
    const utils = trpc.useContext()

    const { data: learningState, isLoading: isLoadingState } = trpc.getLearningState.useQuery(
        { fileId, sessionKey },
        { enabled: !!sessionKey }
    )

    const { data: chapters } = trpc.getChapters.useQuery({ fileId })

    const { mutate: completeTopic, isLoading: isCompleting } = trpc.completeTopic.useMutation({
        onSuccess: (data) => {
            if (data.quizReady) {
                toast({
                    title: 'Chapter Complete!',
                    description: 'You\'re ready for the chapter quiz. Good luck!',
                    variant: 'default',
                })
            } else {
                toast({
                    title: 'Topic Completed!',
                    description: 'Great job! Moving to the next topic.',
                    variant: 'default',
                })
            }
            utils.getLearningState.invalidate()
            utils.getFileAnalytics.invalidate()
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to complete topic. Please try again.',
                variant: 'destructive',
            })
        }
    })

    // Handle smart completion trigger
    useEffect(() => {
        if (isSmartCompletionDetected && !isCompleting && learningState) {
            completeTopic({
                fileId,
                sessionKey,
                chapterNumber: learningState.currentChapter,
                topicNumber: learningState.currentTopic
            })
            resetSmartCompletion()
        }
    }, [isSmartCompletionDetected, isCompleting, learningState, completeTopic, fileId, sessionKey, resetSmartCompletion])

    if (!learningState || !chapters) return null

    const currentChapter = chapters.find(c => c.chapterNumber === learningState.currentChapter)
    if (!currentChapter) return null

    const currentTopic = currentChapter.topics.find(t => t.topicNumber === learningState.currentTopic)

    // If no topic found, maybe we finished the chapter?
    if (!currentTopic && learningState.currentTopic > currentChapter.topics.length) {
        return (
            <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-md border border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Chapter Complete</span>
            </div>
        )
    }

    if (!currentTopic) return null

    return (
        <div className="flex items-center gap-3 bg-white px-3 py-1.5 rounded-md border shadow-sm">
            <div className="flex flex-col">
                <span className="text-xs text-zinc-500 uppercase font-bold">Current Topic</span>
                <span className="text-sm font-medium max-w-[150px] truncate" title={currentTopic.title}>
                    {learningState.currentChapter}.{learningState.currentTopic} {currentTopic.title}
                </span>
            </div>

            <Button
                size="sm"
                onClick={() => completeTopic({
                    fileId,
                    sessionKey,
                    chapterNumber: learningState.currentChapter,
                    topicNumber: learningState.currentTopic
                })}
                disabled={isCompleting}
                className="bg-green-600 hover:bg-green-700 text-white h-8"
            >
                {isCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="flex items-center">Next <ArrowRight className="ml-1 h-3 w-3" /></span>}
            </Button>
        </div>
    )
}
