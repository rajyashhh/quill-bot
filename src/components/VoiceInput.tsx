'use client'

import { Mic, MicOff, Volume2 } from 'lucide-react'
import { Button } from './ui/button'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface VoiceInputProps {
  onTranscript: (text: string) => void
  className?: string
}

export const VoiceInput = ({ onTranscript, className }: VoiceInputProps) => {
  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
    isSupported
  } = useVoiceRecognition()

  const [showTranscript, setShowTranscript] = useState(false)

  useEffect(() => {
    if (transcript && !isListening) {
      // Send the transcript when recording stops
      onTranscript(transcript)
      resetTranscript()
      setShowTranscript(false)
    } else if (transcript && isListening) {
      setShowTranscript(true)
    }
  }, [transcript, isListening, onTranscript, resetTranscript])

  const handleToggleListening = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  if (!isSupported) {
    return (
      <div className="text-sm text-muted-foreground">
        Voice input is not supported in your browser
      </div>
    )
  }

  return (
    <div className={cn("relative", className)}>
      <Button
        onClick={handleToggleListening}
        variant={isListening ? "destructive" : "secondary"}
        size="icon"
        className={cn(
          "transition-all",
          isListening && "animate-pulse"
        )}
        title={isListening ? "Stop recording" : "Start voice input"}
      >
        {isListening ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>

      {/* Live transcript display */}
      {showTranscript && transcript && (
        <div className="absolute bottom-full mb-2 left-0 right-0 min-w-[200px] p-2 bg-secondary rounded-md shadow-lg">
          <div className="flex items-start gap-2">
            <Volume2 className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <p className="text-sm">{transcript}</p>
          </div>
        </div>
      )}
    </div>
  )
}
