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

  const { fileId, message } =
    SendMessageValidator.parse(body)

  const file = await db.file.findFirst({
    where: {
      id: fileId,
    },
  })

  if (!file)
    return new Response('Not found', { status: 404 })

  await db.message.create({
    data: {
      text: message,
      isUserMessage: true,
      fileId,
    },
  })

  // 1: vectorize message
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  })

  const pinecone = await getPineconeClient()
  const pineconeIndex = pinecone.Index('quill')

  // Create embedding for the query
  const queryEmbedding = await embeddings.embedQuery(message)

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

  // Extract the text content from the results with page numbers
  const results = queryResponse.matches?.map((match) => ({
    pageContent: match.metadata?.text || '',
    metadata: {
      pageNumber: match.metadata?.pageNumber,
      score: match.score,
    },
  })) || []

  console.log('[CHAT] Extracted results:', results.length, 'documents')
  
  // Format context with page numbers
  const contextWithPages = results.map((r) => {
    const pageNum = r.metadata.pageNumber ? `[Page ${r.metadata.pageNumber}]` : '[Page unknown]'
    return `${pageNum} ${r.pageContent}`
  }).join('\n\n')

  const prevMessages = await db.message.findMany({
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

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-2025-08-07',
    stream: true,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant that answers questions based on the provided PDF context. Always cite the page numbers where you found the information. Use the following pieces of context to answer the users question accurately and comprehensively. Format your response in markdown when appropriate.',
      },
      {
        role: 'user',
        content: `Answer the following question based on the provided context. Each piece of context is prefixed with its page number in square brackets like [Page 123]. When you use information from the context, ALWAYS cite the page number(s) where you found it. If the answer cannot be found in the context, say "I cannot find information about that in the provided PDF."
        
  \n----------------\n
  
  PREVIOUS CONVERSATION:
  ${formattedPrevMessages.map((message) => {
    if (message.role === 'user')
      return `User: ${message.content}\n`
    return `Assistant: ${message.content}\n`
  })}
  
  \n----------------\n
  
  CONTEXT WITH PAGE NUMBERS:
  ${contextWithPages}
  
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
      } catch (error) {
        controller.error(error)
      } finally {
        controller.close()
      }
    },
  })

  return new StreamingTextResponse(stream)
  } catch (error) {
    console.error('[MESSAGE_ERROR]', error)
    return new Response('Internal error', { status: 500 })
  }
}
