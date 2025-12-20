import { OpenAI } from 'openai'
import { db } from '@/db'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface GenerateQuizOptions {
  fileId: string
  chapterNumber: number
  chapterContent: string
  chapterTitle: string
  topics: string[]
  count?: number
  retry?: boolean
}

export async function generateChapterQuiz(options: GenerateQuizOptions) {
  const {
    fileId,
    chapterNumber,
    chapterContent,
    chapterTitle,
    topics,
    count = 10,
    retry = false
  } = options

  console.log(`🎯 [QuizGen] Generating ${count} questions for Chapter ${chapterNumber}: ${chapterTitle} (Retry: ${retry})`)

  const prompt = `You are an expert educator creating a quiz based on this textbook chapter.
${retry ? 'IMPORTANT: This is a RETRY attempt. Create COMPLETELY NEW and DIFFERENT questions from common ones. Focus on deeper understanding to test the student.' : ''}

CHAPTER: ${chapterTitle}
AVAILABLE TOPICS: ${topics.join(', ')}

CHAPTER CONTENT:
${chapterContent.substring(0, 25000)}

Create ${count} multiple-choice questions that:
1. Test key concepts and understanding (not just memorization)
2. Have 4 options each (A, B, C, D)
3. Include clear explanations for correct answers
4. Cover ALL topics listed above evenly (balanced distribution)
5. Are challenging and appropriate for a comprehensive chapter exam
6. Reference specific page numbers or concepts from the content

Return ONLY a valid JSON array with this EXACT structure (no markdown, no extra text):
[
  {
    "question": "What is the primary purpose of the wing?",
    "options": ["Generate lift", "Provide stability", "Store fuel", "House landing gear"],
    "correctAnswer": "Generate lift",
    "explanation": "Wings generate lift...",
    "topicCovered": "Exact String from AVAILABLE TOPICS",
    "difficulty": "medium"
  }
]`

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert quiz generator. Return ONLY valid JSON arrays. Never use markdown code blocks.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],

      max_completion_tokens: 5000,
    })

    const choice = response.choices[0]
    console.log('🤖 [QuizGen] Finish reason:', choice.finish_reason)
    const content = choice.message.content?.trim() || '[]'
    console.log('🤖 [QuizGen] Raw response length:', content.length)

    // Parse JSON response
    let questions
    try {
      questions = JSON.parse(content)
    } catch (error) {
      // Try to extract JSON from markdown code blocks
      console.log('⚠️ [QuizGen] Failed to parse, trying to extract from markdown...')
      const jsonMatch = content.match(/``````/)
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[1])
      } else {
        throw new Error('Failed to parse quiz questions from AI response')
      }
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('AI returned invalid question format')
    }

    console.log(`✅ [QuizGen] Generated ${questions.length} questions`)

    // Save questions to database
    const savedQuestions = await Promise.all(
      questions.map(async (q: any) => {
        return await db.quizQuestion.create({
          data: {
            fileId,
            chapterNumber,
            question: q.question,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            difficulty: q.difficulty || 'medium',
            topicCovered: q.topicCovered || 'General',
          },
        })
      })
    )

    console.log(`💾 [QuizGen] Saved ${savedQuestions.length} questions to database`)
    return savedQuestions

  } catch (error) {
    console.error('❌ [QuizGen] Error:', error)
    throw error
  }
}
