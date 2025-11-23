import { Send } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { useContext, useRef, useEffect } from 'react'
import { ChatContext } from './ChatContext'
import { VoiceInput } from '../VoiceInput'

interface ChatInputProps {
  isDisabled?: boolean
}

const ChatInput = ({ isDisabled }: ChatInputProps) => {
  const {
    addMessage,
    handleInputChange,
    isLoading,
    message,
  } = useContext(ChatContext)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ============ NEW: Initialize session key ============
  useEffect(() => {
    // Ensure session key exists in sessionStorage
    const existingKey = sessionStorage.getItem('sessionKey')
    if (!existingKey) {
      const newKey = `session-${Date.now()}`
      sessionStorage.setItem('sessionKey', newKey)
      console.log('🔑 [ChatInput] Created session key:', newKey)
    } else {
      console.log('🔑 [ChatInput] Using existing session key:', existingKey)
    }
  }, [])
  // ============ END NEW ============

  const handleVoiceTranscript = (transcript: string) => {
    // Update the message with voice transcript
    handleInputChange({ target: { value: transcript } } as any)
    // Automatically send the message
    setTimeout(() => {
      addMessage()
      textareaRef.current?.focus()
    }, 100)
  }

  return (
    <div className='absolute bottom-0 left-0 w-full'>
      <div className='mx-2 flex flex-row gap-3 md:mx-4 md:last:mb-6 lg:mx-auto lg:max-w-2xl xl:max-w-3xl'>
        <div className='relative flex h-full flex-1 items-stretch md:flex-col'>
          <div className='relative flex flex-col w-full flex-grow p-4'>
            <div className='relative'>
              <Textarea
                rows={1}
                ref={textareaRef}
                maxRows={4}
                autoFocus
                onChange={handleInputChange}
                value={message}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()

                    addMessage()

                    textareaRef.current?.focus()
                  }
                }}
                placeholder='Enter your question...'
                className='resize-none pr-20 text-base py-3 scrollbar-thumb-blue scrollbar-thumb-rounded scrollbar-track-blue-lighter scrollbar-w-2 scrolling-touch'
              />

              <div className='absolute bottom-1.5 right-[8px] flex gap-1'>
                <VoiceInput 
                  onTranscript={handleVoiceTranscript}
                  className={isLoading || isDisabled ? 'pointer-events-none opacity-50' : ''}
                />
                
                <Button
                  disabled={isLoading || isDisabled}
                  aria-label='send message'
                  onClick={() => {
                    addMessage()

                    textareaRef.current?.focus()
                  }}>
                  <Send className='h-4 w-4' />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatInput
