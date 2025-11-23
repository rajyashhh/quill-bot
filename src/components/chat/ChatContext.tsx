import {
  ReactNode,
  createContext,
  useRef,
  useState,
  useEffect,
} from 'react'
import { useToast } from '../ui/use-toast'
import { useMutation } from '@tanstack/react-query'
import { trpc } from '@/app/_trpc/client'
import { INFINITE_QUERY_LIMIT } from '@/config/infinite-query'

type StreamResponse = {
  addMessage: () => void
  message: string
  handleInputChange: (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => void
  isLoading: boolean
}

export const ChatContext = createContext<StreamResponse>({
  addMessage: () => {},
  message: '',
  handleInputChange: () => {},
  isLoading: false,
})

interface Props {
  fileId: string
  children: ReactNode
}

export const ChatContextProvider = ({
  fileId,
  children,
}: Props) => {
  const [message, setMessage] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const utils = trpc.useContext()

  const { toast } = useToast()

  const backupMessage = useRef('')

  // ============ NEW: Initialize and manage session key ============
  const [sessionKey, setSessionKey] = useState<string>('')

  useEffect(() => {
    // Get or create session key
    const existingKey = sessionStorage.getItem('sessionKey')
    if (existingKey) {
      console.log('🔑 [ChatContext] Using existing session key:', existingKey)
      setSessionKey(existingKey)
    } else {
      const newKey = `session-${Date.now()}`
      sessionStorage.setItem('sessionKey', newKey)
      console.log('🔑 [ChatContext] Created new session key:', newKey)
      setSessionKey(newKey)
    }
  }, [])
  // ============ END NEW ============

  const { mutate: sendMessage } = useMutation({
    mutationFn: async ({
      message,
      sessionKey, // ADDED
    }: {
      message: string
      sessionKey: string // ADDED
    }) => {
      console.log('📤 [ChatContext] Sending message with session:', sessionKey)
      
      const response = await fetch('/api/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-key': sessionKey, // ADDED
        },
        body: JSON.stringify({
          fileId,
          message,
          sessionKey, // ADDED
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to send message')
      }

      // Extract images data from header
      const imagesData = response.headers.get('X-Images-Data')
      const images = imagesData ? JSON.parse(imagesData) : []

      // ADDED: Extract learning state from headers
      const learningPhase = response.headers.get('X-Learning-Phase')
      const shouldQuiz = response.headers.get('X-Should-Quiz') === 'true'
      const messageCount = response.headers.get('X-Message-Count')

      console.log('📊 [ChatContext] Learning state:', { learningPhase, shouldQuiz, messageCount })

      return { 
        body: response.body, 
        images,
        learningPhase,
        shouldQuiz,
        messageCount,
      }
    },
    onMutate: async ({ message }) => {
      backupMessage.current = message
      setMessage('')

      // step 1
      await utils.getFileMessages.cancel()

      // step 2
      const previousMessages =
        utils.getFileMessages.getInfiniteData()

      // step 3
      utils.getFileMessages.setInfiniteData(
        { fileId, limit: INFINITE_QUERY_LIMIT },
        (old) => {
          if (!old) {
            return {
              pages: [],
              pageParams: [],
            }
          }

          let newPages = [...old.pages]

          let latestPage = newPages[0]!

          latestPage.messages = [
            {
              createdAt: new Date().toISOString(),
              id: crypto.randomUUID(),
              text: message,
              isUserMessage: true,
            },
            ...latestPage.messages,
          ]

          newPages[0] = latestPage

          return {
            ...old,
            pages: newPages,
          }
        }
      )

      setIsLoading(true)

      return {
        previousMessages:
          previousMessages?.pages.flatMap(
            (page) => page.messages
          ) ?? [],
      }
    },
    onSuccess: async (result) => {
      setIsLoading(false)

      if (!result || !result.body) {
        return toast({
          title: 'There was a problem sending this message',
          description:
            'Please refresh this page and try again',
          variant: 'destructive',
        })
      }

      const { body: stream, images } = result
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let done = false

      // accumulated response
      let accResponse = ''

      while (!done) {
        const { value, done: doneReading } =
          await reader.read()
        done = doneReading
        const chunkValue = decoder.decode(value)

        accResponse += chunkValue

        // append chunk to the actual message
        utils.getFileMessages.setInfiniteData(
          { fileId, limit: INFINITE_QUERY_LIMIT },
          (old) => {
            if (!old) return { pages: [], pageParams: [] }

            let isAiResponseCreated = old.pages.some(
              (page) =>
                page.messages.some(
                  (message) => message.id === 'ai-response'
                )
            )

            let updatedPages = old.pages.map((page) => {
              if (page === old.pages[0]) {
                let updatedMessages

                if (!isAiResponseCreated) {
                  updatedMessages = [
                    {
                      createdAt: new Date().toISOString(),
                      id: 'ai-response',
                      text: accResponse,
                      isUserMessage: false,
                      images: images,
                    },
                    ...page.messages,
                  ]
                } else {
                  updatedMessages = page.messages.map(
                    (message) => {
                      if (message.id === 'ai-response') {
                        return {
                          ...message,
                          text: accResponse,
                        }
                      }
                      return message
                    }
                  )
                }

                return {
                  ...page,
                  messages: updatedMessages,
                }
              }

              return page
            })

            return { ...old, pages: updatedPages }
          }
        )
      }

      // ============ NEW: Invalidate learning state after message ============
      await utils.getLearningState.invalidate({
        fileId,
        sessionKey,
      })
      console.log('🔄 [ChatContext] Invalidated learning state')
      // ============ END NEW ============
    },

    onError: (_, __, context) => {
      setMessage(backupMessage.current)
      utils.getFileMessages.setData(
        { fileId },
        { messages: context?.previousMessages ?? [] }
      )
    },
    onSettled: async () => {
      setIsLoading(false)

      await utils.getFileMessages.invalidate({ fileId })
    },
  })

  const handleInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    setMessage(e.target.value)
  }

  // ============ UPDATED: Pass session key ============
  const addMessage = () => {
    if (!sessionKey) {
      console.error('❌ [ChatContext] No session key available!')
      return
    }
    console.log('📨 [ChatContext] Adding message with session:', sessionKey)
    sendMessage({ message, sessionKey })
  }
  // ============ END UPDATE ============

  return (
    <ChatContext.Provider
      value={{
        addMessage,
        message,
        handleInputChange,
        isLoading,
      }}>
      {children}
    </ChatContext.Provider>
  )
}
