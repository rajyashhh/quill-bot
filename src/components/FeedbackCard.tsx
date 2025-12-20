'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Edit2, Save, X } from 'lucide-react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { trpc } from '@/app/_trpc/client'
import { useToast } from './ui/use-toast'

interface FeedbackCardProps {
  feedback: {
    id: string
    feedbackType: 'THUMBS_UP' | 'THUMBS_DOWN'
    feedbackCategory: string | null
    feedbackReason: string | null
    correctedResponse: string | null
    createdAt: Date
    userQuestion: string
    Message: {
      text: string
      createdAt: Date
    }
  }
}

export default function FeedbackCard({ feedback }: FeedbackCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [correctedText, setCorrectedText] = useState(
    feedback.correctedResponse || ''
  )
  const { toast } = useToast()
  const utils = trpc.useContext()

  const { mutate: updateFeedback, isLoading } = trpc.updateMessageFeedback.useMutation({
    onSuccess: () => {
      toast({
        title: 'Feedback updated',
        description: 'The corrected response has been saved.',
      })
      setIsEditing(false)
      utils.getFileAnalytics.invalidate()
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to update feedback.',
        variant: 'destructive',
      })
    },
  })

  const handleSave = () => {
    updateFeedback({
      feedbackId: feedback.id,
      correctedResponse: correctedText,
    })
  }

  const isNegative = feedback.feedbackType === 'THUMBS_DOWN'

  return (
    <div
      className={`border rounded-lg p-5 ${isNegative ? 'border-red-200 bg-red-50/30' : 'border-green-200 bg-green-50/30'
        }`}
    >
      {/* Feedback Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isNegative ? (
            <ThumbsDown className="h-5 w-5 text-red-600" />
          ) : (
            <ThumbsUp className="h-5 w-5 text-green-600" />
          )}
          <div>
            <p className="font-medium text-sm">
              {isNegative ? 'Negative Feedback' : 'Positive Feedback'}
            </p>
            <p className="text-xs text-zinc-500">
              {new Date(feedback.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {/* Edit button for negative feedback */}
        {isNegative && !isEditing && (
          <Button
            onClick={() => setIsEditing(true)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Edit2 className="h-3 w-3" />
            Edit
          </Button>
        )}
      </div>

      {/* User Question */}
      <div className="mb-4">
        <p className="text-xs font-medium text-zinc-600 mb-1">User Question:</p>
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm text-zinc-800">{feedback.userQuestion}</p>
        </div>
      </div>

      {/* AI Response */}
      <div className="mb-4">
        <p className="text-xs font-medium text-zinc-600 mb-1">AI Response:</p>
        <div className="bg-zinc-50 border border-zinc-200 rounded-md p-3">
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">
            {feedback.Message.text}
          </p>
        </div>
      </div>

      {/* Feedback Category & Reason */}
      {(feedback.feedbackCategory || feedback.feedbackReason) && (
        <div className="mb-4">
          <p className="text-xs font-medium text-zinc-600 mb-1">Feedback Details:</p>
          <div className="bg-zinc-100 rounded-md p-3 space-y-1">
            {feedback.feedbackCategory && (
              <p className="text-xs text-zinc-700">
                <span className="font-medium">Category:</span> {feedback.feedbackCategory}
              </p>
            )}
            {feedback.feedbackReason && (
              <p className="text-xs text-zinc-700">
                <span className="font-medium">Reason:</span> {feedback.feedbackReason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Corrected Response Section */}
      {isNegative && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-zinc-600">
              Suggested Better Response:
            </p>
            {isEditing && (
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={isLoading}
                  size="sm"
                  className="gap-1 h-7 px-2"
                >
                  <Save className="h-3 w-3" />
                  Save
                </Button>
                <Button
                  onClick={() => {
                    setIsEditing(false)
                    setCorrectedText(feedback.correctedResponse || '')
                  }}
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>

          {isEditing ? (
            <Textarea
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              placeholder="Write a better response here..."
              className="min-h-[100px] text-sm"
            />
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-md p-3">
              {correctedText ? (
                <p className="text-sm text-zinc-800 whitespace-pre-wrap">
                  {correctedText}
                </p>
              ) : (
                <p className="text-sm text-zinc-400 italic">
                  No corrected response provided yet. Click Edit to add one.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
