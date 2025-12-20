'use client'

import { useState } from 'react'
import { trpc } from '@/app/_trpc/client'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { X, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { useToast } from '../ui/use-toast'

interface QuizModalProps {
  fileId: string
  chapterNumber: number
  sessionKey: string
  onClose: () => void
}

export default function QuizModal({ fileId, chapterNumber, sessionKey, onClose }: QuizModalProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [showResults, setShowResults] = useState(false)
  const [results, setResults] = useState<any>(null) // ADDED: Store results
  const { toast } = useToast()

  console.log('🎯 [QuizModal] Rendering with:', { fileId, chapterNumber, sessionKey }) // ADDED: Debug log

  // Fetch quiz questions
  const { data: questions, isLoading, error } = trpc.generateChapterQuiz.useQuery({ // ADDED: error
    fileId,
    chapterNumber,
  })

  console.log('📝 [QuizModal] Questions:', questions?.length, 'Loading:', isLoading, 'Error:', error) // ADDED: Debug log

  // Submit quiz mutation
  const { mutate: submitQuiz, isLoading: isSubmitting } = trpc.submitQuizAnswers.useMutation({
    onSuccess: (result) => {
      console.log('✅ [QuizModal] Quiz result:', result) // ADDED: Debug log
      setResults(result) // ADDED: Store results
      setShowResults(true)
      toast({
        title: result.passed ? 'Congratulations! 🎉' : 'Keep Learning!',
        description: result.passed
          ? `You scored ${result.score}/${result.totalQuestions}! Moving to next chapter.`
          : `You scored ${result.score}/${result.totalQuestions}. Let's review: ${result.weakTopics.join(', ')}`,
      })
    },
    onError: (error) => { // ADDED: Error handling
      console.error('❌ [QuizModal] Submit error:', error)
      toast({
        title: 'Error',
        description: 'Failed to submit quiz',
        variant: 'destructive',
      })
    },
  })

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading quiz questions...</p>
        </Card>
      </div>
    )
  }

  // ADDED: Error state
  if (error) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="p-8 text-center max-w-md">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Error Loading Quiz</h3>
          <p className="text-zinc-600 mb-4">{error.message}</p>
          <Button onClick={onClose}>Close</Button>
        </Card>
      </div>
    )
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="p-8 text-center max-w-md">
          <p className="text-zinc-600 mb-4">No quiz questions available yet.</p>
          <p className="text-sm text-zinc-500 mb-4">Questions are being generated...</p>
          <Button onClick={onClose}>Close</Button>
        </Card>
      </div>
    )
  }

  // ADDED: Results display
  if (showResults && results) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <Card className="max-w-2xl w-full p-8">
          <div className="text-center">
            {results.passed ? (
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            ) : (
              <XCircle className="h-16 w-16 text-orange-500 mx-auto mb-4" />
            )}

            <h2 className="text-3xl font-bold mb-2">
              {results.passed ? 'Excellent Work!' : 'Keep Practicing!'}
            </h2>

            <div className="text-5xl font-bold text-blue-600 my-6">
              {results.score}/{results.totalQuestions}
            </div>

            {!results.passed && results.weakTopics?.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mt-4">
                <h3 className="font-semibold text-orange-900 mb-2">Topics to Review:</h3>
                <ul className="text-left text-orange-800 space-y-1">
                  {results.weakTopics.map((topic: string, i: number) => (
                    <li key={i} className="ml-4">• {topic}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button onClick={onClose} className="w-full mt-6">
              {results.passed ? 'Continue to Next Chapter' : 'Review Topics'}
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const question = questions[currentQuestion] as any

  const handleAnswer = (answer: string) => {
    setAnswers({ ...answers, [question.id]: answer })
  }

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1)
    } else {
      // Submit quiz
      console.log('📤 [QuizModal] Submitting answers:', Object.keys(answers).length) // ADDED: Debug log
      submitQuiz({
        fileId,
        chapterNumber,
        sessionKey,
        answers: Object.entries(answers).map(([questionId, selectedAnswer]) => ({
          questionId,
          selectedAnswer,
        })),
      })
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">
            Chapter {chapterNumber} Quiz
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-700">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-zinc-600 mb-2">
            <span>Question {currentQuestion + 1} of {questions.length}</span>
            <span>{Object.keys(answers).length} answered</span>
          </div>
          <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Question */}
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-4">{question.question}</h3>

          <div className="space-y-3">
            {(question.options as string[]).map((option: string, index: number) => {
              const isSelected = answers[question.id] === option

              return (
                <button
                  key={index}
                  onClick={() => handleAnswer(option)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-zinc-200 hover:border-zinc-300'
                    }`}
                >
                  <span className="font-medium">{String.fromCharCode(65 + index)}.</span> {option}
                </button>
              )
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
            disabled={currentQuestion === 0}
          >
            Previous
          </Button>

          <Button
            onClick={handleNext}
            disabled={!answers[question.id] || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Submitting...
              </>
            ) : currentQuestion === questions.length - 1 ? (
              'Submit Quiz'
            ) : (
              'Next'
            )}
          </Button>
        </div>
      </Card>
    </div>
  )
}
