import { db } from '@/db'
import { getPineconeClient } from '@/lib/pinecone'
import { SendMessageValidator } from '@/lib/validators/SendMessageValidator'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { NextRequest } from 'next/server'

import { StreamingTextResponse } from 'ai'
import { OpenAI } from 'openai'

export const POST = async (req: NextRequest) => {
  try {
    // endpoint for asking a question to a pdf file

    const body = await req.json()

    const { fileId, message } = SendMessageValidator.parse(body)

    const file = await db.file.findFirst({
      where: {
        id: fileId,
      },
    })

    // Fetch chapters separately to avoid TypeScript errors
    const chapters = await db.chapter.findMany({
      where: {
        fileId: fileId,
      },
      include: {
        topics: true
      },
      orderBy: {
        chapterNumber: 'asc'
      }
    })

    if (!file) return new Response('Not found', { status: 404 })

    // Check for special "START_SESSION" message
    const isStartSession = message === '[START_SESSION]'

    if (!isStartSession) {
      await db.message.create({
        data: {
          text: message,
          isUserMessage: true,
          fileId,
        },
      })
    } else {
      console.log('[TUTOR] Received START_SESSION trigger')
    }

    // ============ NEW: AI TUTOR LOGIC ============
    // Get session key from headers OR body
    const sessionKey = req.headers.get('x-session-key') ||
      body.sessionKey ||
      `session-${Date.now()}`

    console.log('[TUTOR] Using session key:', sessionKey)

    // Get or create learning state
    let learningState = await db.learningState.findUnique({
      where: { sessionKey },
    })

    console.log('[TUTOR] Found learning state:', learningState)

    if (!learningState) {
      console.log('[TUTOR] Creating new learning state')

      // Try to recover state from StudentProgress (Analytics) to be smart
      const progress = await db.studentProgress.findUnique({
        where: { fileId }
      })

      const initialChapter = progress?.currentChapter || 1
      const initialTopic = progress?.currentTopic || 1

      learningState = await db.learningState.create({
        data: {
          fileId,
          sessionKey,
          currentChapter: initialChapter,
          currentTopic: initialTopic,
          learningPhase: progress ? 'learning' : 'introduction', // Skip intro if resuming
          messageCount: 0,
        },
      })
      console.log('[TUTOR] Created state (recovered):', learningState)
    }

    // Increment message count and update last interaction
    const updatedState = await db.learningState.update({
      where: { sessionKey },
      data: {
        messageCount: { increment: 1 },
        lastInteraction: new Date(),
      },
    })


    console.log('[TUTOR] Updated message count to:', updatedState.messageCount)
    // Get current chapter for context
    const currentChapter = chapters.find(ch => ch.chapterNumber === updatedState.currentChapter)
    const currentTopic = currentChapter?.topics.find(t => t.topicNumber === updatedState.currentTopic)
    const isLastTopic = currentTopic && currentChapter && currentTopic.topicNumber === currentChapter.topics.length
    // We default to false because we now use strict gatekeeping via completeTopic
    const shouldTriggerQuiz = false

    // Check if the query is asking about chapters/topics
    const isChapterQuery = /chapter|topic|section|unit|module/i.test(message)
    const chapterNumberMatch = message.match(/chapter\s*(\d+)/i)

    let chapterInfo = ''
    if (isChapterQuery && chapters.length > 0) {
      if (chapterNumberMatch) {
        // User is asking about a specific chapter
        const chapterNum = parseInt(chapterNumberMatch[1])
        const chapter = chapters.find((ch: { chapterNumber: number }) => ch.chapterNumber === chapterNum)
        if (chapter) {
          chapterInfo = `\n\nChapter ${chapter.chapterNumber}: ${chapter.title}\n`
          chapterInfo += `Pages: ${chapter.startPage}-${chapter.endPage}\n`
          if (chapter.topics.length > 0) {
            chapterInfo += `\nTopics in this chapter:\n`
            chapter.topics.forEach((topic: { topicNumber: any; title: any; estimatedTime: any }) => {
              chapterInfo += `- Topic ${topic.topicNumber}: ${topic.title} (Est. ${topic.estimatedTime} mins)\n`
            })
          }
        }
      } else {
        // User is asking about chapters in general
        chapterInfo = `\n\nAvailable Chapters:\n`
        chapters.forEach((chapter: { chapterNumber: any; title: any; startPage: any; endPage: any }) => {
          chapterInfo += `- Chapter ${chapter.chapterNumber}: ${chapter.title} (Pages ${chapter.startPage}-${chapter.endPage})\n`
        })
      }
    }

    // 1: vectorize message
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    })

    const pinecone = await getPineconeClient()
    const pineconeIndex = pinecone.Index('quill')

    // Create embedding for the query
    let queryText = message
    if (isStartSession) {
      queryText = `Chapter ${updatedState.currentChapter} ${currentChapter?.title || ''} Topic ${updatedState.currentTopic} ${currentTopic?.title || ''}`
    }

    const queryEmbedding = await embeddings.embedQuery(queryText)

    // Query Pinecone directly
    console.log('[CHAT] Querying Pinecone with namespace:', file.id)
    const queryResponse = await pineconeIndex
      .namespace(file.id)
      .query({
        vector: queryEmbedding,
        topK: 10, // Increased from 4 to get more context
        includeValues: false,
        includeMetadata: true,
      })

    console.log('[CHAT] Query response:', JSON.stringify(queryResponse, null, 2))

    // Extract the text content from the results with page numbers and image references
    const results = queryResponse.matches?.map((match) => ({
      pageContent: (match.metadata?.text as string) || '',
      metadata: {
        pageNumber: match.metadata?.pageNumber,
        score: match.score,
        imageIds: match.metadata?.imageIds || [],
        referencedImageIds: match.metadata?.referencedImageIds || [],
        hasImages: match.metadata?.hasImages || false,
        source: match.metadata?.source, // Track if this is OCR content
      },
    })) || []

    console.log('[CHAT] Extracted results:', results.length, 'documents')

    // Check if we got any OCR results from Pinecone
    const ocrResults = results.filter(r => r.metadata.source === 'OCR')
    const hasOcrResults = ocrResults.length > 0
    const hasGoodOcrContent = ocrResults.some(r => r.pageContent.length > 50)

    console.log('[CHAT] OCR results from Pinecone:', ocrResults.length)
    console.log('[CHAT] Has good OCR content:', hasGoodOcrContent)

    // If file used OCR but we have poor/no results, add full OCR text as fallback
    let ocrContext = ''
    if (file.usedOCR && file.ocrText) {
      if (!hasOcrResults || !hasGoodOcrContent) {
        console.log('[CHAT] Adding full OCR text from database (', file.ocrText.length, 'chars)')
        // Use more of the OCR text if we have no good results at all
        const maxLength = hasOcrResults ? 3000 : 8000
        ocrContext = `\n\n---------------- OCR EXTRACTED TEXT ----------------\n${file.ocrText.substring(0, maxLength)}\n`
      } else {
        console.log('[CHAT] Using OCR results from Pinecone')
      }
    }

    // Collect all unique image IDs from the results
    const allImageIds = new Set<string>()
    results.forEach(result => {
      if (result.metadata.imageIds && Array.isArray(result.metadata.imageIds)) {
        result.metadata.imageIds.forEach((id: string) => allImageIds.add(id))
      }
      if (result.metadata.referencedImageIds && Array.isArray(result.metadata.referencedImageIds)) {
        result.metadata.referencedImageIds.forEach((id: string) => allImageIds.add(id))
      }
    })

    // Fetch image data if any images are referenced
    let images: any[] = []
    if (allImageIds.size > 0) {
      console.log('[CHAT] Fetching', allImageIds.size, 'images')
      images = await db.extractedImage.findMany({
        where: {
          id: {
            in: Array.from(allImageIds)
          }
        },
        select: {
          id: true,
          imageUrl: true,
          caption: true,
          pageNumber: true,
          imageType: true,
          topics: true,
        }
      })
      console.log('[CHAT] Found', images.length, 'images')
    }

    // Format context with page numbers
    const contextWithPages = results
      .filter(r => r.pageContent.trim().length > 0) // Filter out empty content
      .map((r) => {
        const pageNum = r.metadata.pageNumber ? `[Page ${r.metadata.pageNumber}]` : '[Page unknown]'
        const sourceTag = r.metadata.source === 'OCR' ? ' [OCR]' : ''
        return `${pageNum}${sourceTag} ${r.pageContent}`
      }).join('\n\n')

    const prevMessages = isStartSession ? [] : await db.message.findMany({
      where: {
        fileId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 6,
    })

    const formattedPrevMessages = prevMessages.map((msg) => ({
      role: msg.isUserMessage
        ? ('user' as const)
        : ('assistant' as const),
      content: msg.text,
    }))


    // ============ NEW: BUILD AI TUTOR SYSTEM PROMPT ============
    let tutorPrompt = ''


    if (updatedState.learningPhase === 'introduction') {
      // Build full chapter list for the overview
      const allChaptersList = chapters.map(c => `- Chapter ${c.chapterNumber}: ${c.title}`).join('\n')

      if (updatedState.currentChapter === 1) {
        // BOOK INTRODUCTION (First time)
        tutorPrompt = `\n\n🎓 AI TUTOR MODE: INTRODUCTION
You are introducing the book "${file.name}".
Available Chapters:
${allChaptersList}

Your Goal:
1.  **Book Overview**: Briefly summarize what this whole book is about (1-2 sentences).
2.  **Roadmap**: Mention that there are ${chapters.length} chapters to cover.
3.  **Approve Start**: Introduce Chapter 1 (${updatedState.currentChapter}: ${currentChapter?.title}) and ask if they are ready to begin.
Keep it structured and encouraging.
CRITICAL: Do NOT use the "[TOPIC_COMPLETED]" token in this phase.`
      } else {
        // CHAPTER INTRODUCTION (Subsequent chapters)
        // Build topic list for this chapter
        const topicList = currentChapter?.topics.map(t => `- ${t.title}`).join('\n') || 'Topics not listed.'

        tutorPrompt = `\n\n🎓 AI TUTOR MODE: CHAPTER INTRODUCTION
Status: Student has just unlocked Chapter ${updatedState.currentChapter}: ${currentChapter?.title}.

Your Goal:
1.  **Congratulate**: Praise them for completing the previous chapter.
2.  **Chapter Preview**: Briefly explain what Chapter ${updatedState.currentChapter} covers.
3.  **Roadmap**: List the topics:
${topicList}
4.  **Start**: Ask if they are ready to begin the first topic.
CRITICAL: Do NOT use the "[TOPIC_COMPLETED]" token in this phase.`
      }

      // Update phase to learning after introduction
      await db.learningState.update({
        where: { sessionKey },
        data: { learningPhase: 'learning' },
      })
    }
    else if (updatedState.learningPhase === 'learning') {
      if (isStartSession) {
        tutorPrompt = `\n\n🎓 AI TUTOR MODE: RESUMING SESSION
Current Chapter: ${updatedState.currentChapter} - ${currentChapter?.title}
Current Topic: ${currentTopic?.title || 'Overview'}

Responsibility:
1. Welcome the student back warmly.
2. Summarize where they left off (Topic ${updatedState.currentTopic}: ${currentTopic?.title}).
3. Ask if they are ready to continue.`
      } else {
        const totalTopics = currentChapter?.topics.length || 0
        const remainingTopicsCount = totalTopics - updatedState.currentTopic

        tutorPrompt = `\n\n🎓 AI TUTOR MODE: TEACHING
Current Chapter: ${updatedState.currentChapter} - ${currentChapter?.title}
Current Topic: ${currentTopic?.title || 'Overview'}
Topics Remaining in Chapter: ${remainingTopicsCount}
Message Count: ${updatedState.messageCount}/8

Teaching Guidelines:
1. Answer questions clearly and concisely
2. Use examples and cite page numbers
3. CRITICAL: Analyze understanding.
   - ONLY IF mastered, start with: "[TOPIC_COMPLETED]"
   - IF student asks to SKIP to next chapter:
     - CHECK "Topics Remaining".
     - If > 0, REFUSE. Say: "We need to cover ${remainingTopicsCount} more topics first."
     - Do NOT emit [TOPIC_COMPLETED] for refused skips.`
      }
    }
    else if (updatedState.learningPhase === 'review') {
      // Fetch latest quiz attempt for context
      const lastAttempt = await db.quizAttempt.findFirst({
        where: {
          sessionKey,
          chapterNumber: updatedState.currentChapter
        },
        orderBy: { createdAt: 'desc' }
      })

      let quizContext = ''
      if (lastAttempt && Array.isArray(lastAttempt.answers)) {
        quizContext = '\n\nQUIZ RESULTS CONTEXT:\n'
        // @ts-ignore
        lastAttempt.answers.forEach((ans: any, i: number) => {
          const status = ans.isCorrect ? '✅ CORRET' : '❌ WRONG'
          quizContext += `Q${i + 1}: ${status}\n`
          if (!ans.isCorrect) {
            quizContext += `   - Your Answer: ${ans.selectedAnswer}\n`
            quizContext += `   - Correct Answer: ${ans.correctAnswer}\n`
            quizContext += `   - Topic: ${ans.topicCovered}\n`
          }
        })
      }

      tutorPrompt = `\n\n🎓 AI TUTOR MODE: REVIEW
The student just FAILED the quiz for Chapter ${updatedState.currentChapter}.
Weak Topics: ${updatedState.reviewTopics.join(', ')}

${quizContext}

Review Guidelines:
1.  **Analyze Mistakes**: Specifically reference the questions they got wrong (e.g., "I noticed you struggled with Question 3 regarding...").
2.  **Explain Concepts**: Don't just give the answer; explain the underlying concept they missed.
3.  **Encourage**: Remind them it's part of learning.
4.  **Retake**: When you feel they understand the weak topics, explicitly suggested retaking the quiz.

CRITICAL GATEKEEPING:
- **Refuse Progression**: If the student asks to move to the next chapter (Chapter ${updatedState.currentChapter + 1}), REFUSE.
- **redirect**: Say "We need to fix these weak topics and pass the quiz first."
- **NO TOKENS**: Do NOT emit [TOPIC_COMPLETED] under any circumstances in this phase. The only way forward is retaking the quiz.`
    }
    else if (updatedState.learningPhase === 'quiz-ready') {
      tutorPrompt = `\n\n🎓 AI TUTOR MODE: GATEKEEPER
Status: Chapter ${updatedState.currentChapter} COMPLETED.
Goal: Student MUST pass the quiz to unlock Chapter ${updatedState.currentChapter + 1}.

Guidelines:
1.  **Refuse Movement**: If they ask to teaching Chapter ${updatedState.currentChapter + 1}, REFUSE.
2.  **Redirect**: Say "You've finished Chapter ${updatedState.currentChapter}! To unlock the next chapter, you need to pass the quiz."
3.  **Encourage**: Tell them they are ready and to click the "Take Quiz" button.`
    }
    // ============ END NEW LOGIC ============

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
      stream: true,
      messages: [
        {
          role: 'system',
          content: `You are an AI tutor helping students learn from their textbook. You guide them through chapters, answer questions, and help them master concepts before moving forward.${tutorPrompt}

Core Responsibilities:
- Answer questions based on the PDF context
- Always cite page numbers where you found information
- Reference relevant images when available
- Use markdown formatting for clarity
- Keep responses concise but thorough
- Be encouraging and supportive`,
        },
        {
          role: 'user',
          content: `Answer the following question based on the provided context. Each piece of context is prefixed with its page number in square brackets like [Page 123]. Some context may be marked as [OCR], which means it was extracted using Optical Character Recognition from scanned pages. When you use information from the context, ALWAYS cite the page number(s) where you found it. If the answer cannot be found in the context, say "I cannot find information about that in the provided PDF."
        
  \n----------------\n
  
  PREVIOUS CONVERSATION:
  ${formattedPrevMessages.map((message) => {
            if (message.role === 'user')
              return `User: ${message.content}\n`
            return `Assistant: ${message.content}\n`
          })}
  
  \n----------------\n
  
  ${chapterInfo ? `CHAPTER INFORMATION:${chapterInfo}\n----------------\n` : ''}
  
  CONTEXT WITH PAGE NUMBERS:
  ${contextWithPages}
  ${ocrContext}
  
  ${images.length > 0 ? `RELEVANT IMAGES:
  ${images.map(img => `- ${img.caption || `Image on page ${img.pageNumber}`} (Page ${img.pageNumber}, Type: ${img.imageType || 'diagram'})`).join('\n')}
  
  Note: The actual images will be displayed to the user alongside your response. Reference them naturally in your answer when relevant.
  ` : ''}
  
  USER INPUT: ${message}`,
        },
      ],
    })

    // Convert the response into a readable stream
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = ''

        try {
          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || ''
            fullResponse += content

            // Encode and send the chunk
            const bytes = new TextEncoder().encode(content)
            controller.enqueue(bytes)
          }

          // Save the complete message after streaming is done
          await db.message.create({
            data: {
              text: fullResponse,
              isUserMessage: false,
              fileId,
            },
          })

          // ============ NEW: CHECK SMART COMPLETION ============
          console.log('[TUTOR] Checking smart completion...')
          const isTopicCompleted = fullResponse.includes('[TOPIC_COMPLETED]')

          if (isTopicCompleted && updatedState.learningPhase === 'learning') {
            console.log('[TUTOR] ✅ AI detected topic completion!')
            // We don't automatically update state here because we want the frontend to handle the transition
            // (showing a button or toast) to give user control.
            // The frontend will see the token in the stream and act accordingly.
          }
          // ============ END NEW LOGIC ============
          // ============ END NEW LOGIC ============
        } catch (error) {
          console.error('[TUTOR] Error:', error)
          controller.error(error)
        } finally {
          controller.close()
        }
      },
    })

    // Return both the stream and images data + learning state
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Images-Data': JSON.stringify(images),
        'X-Learning-Phase': updatedState.learningPhase,
        'X-Should-Quiz': shouldTriggerQuiz.toString(),
        'X-Current-Chapter': updatedState.currentChapter.toString(),
        'X-Message-Count': updatedState.messageCount.toString(),
      },
    })
  } catch (error) {
    console.error('[MESSAGE_ERROR]', error)
    return new Response('Internal error', { status: 500 })
  }
}
