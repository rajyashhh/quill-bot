'use client'

import { Settings, Volume2 } from 'lucide-react'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { useEffect, useState, useCallback } from 'react'

export interface VoiceOption {
  id: string
  name: string
  lang: string
  gender: 'male' | 'female'
}

// Define our 4 voice options with different pitch settings
const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'male1', name: 'David (US Male)', lang: 'en-US', gender: 'male' },
  { id: 'male2', name: 'James (UK Male)', lang: 'en-GB', gender: 'male' },
  { id: 'female1', name: 'Sarah (US Female)', lang: 'en-US', gender: 'female' },
  { id: 'female2', name: 'Emma (UK Female)', lang: 'en-GB', gender: 'female' },
]

// Define pitch and rate settings for each voice to make them sound distinct
const VOICE_SETTINGS = {
  male1: { pitch: 0.6, rate: 0.95 },    // Deeper, slightly slower
  male2: { pitch: 0.8, rate: 1.05 },    // Slightly deeper, normal speed
  female1: { pitch: 1.4, rate: 1.0 },   // Higher pitch, normal speed
  female2: { pitch: 1.2, rate: 0.95 },  // Slightly higher pitch, slightly slower
}

interface VoiceSettingsProps {
  onVoiceChange: (voiceId: string) => void
}

export const VoiceSettings = ({ onVoiceChange }: VoiceSettingsProps) => {
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('female1')
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    // Load saved voice preference
    const savedVoiceId = localStorage.getItem('preferred-voice-id')
    if (savedVoiceId && VOICE_OPTIONS.find(v => v.id === savedVoiceId)) {
      setSelectedVoiceId(savedVoiceId)
      onVoiceChange(savedVoiceId)
    }

    // Load available system voices
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      setAvailableVoices(voices)
    }

    if (window.speechSynthesis) {
      loadVoices()
      window.speechSynthesis.onvoiceschanged = loadVoices
    }
  }, [onVoiceChange])

  const handleVoiceSelect = (voiceId: string) => {
    setSelectedVoiceId(voiceId)
    localStorage.setItem('preferred-voice-id', voiceId)
    onVoiceChange(voiceId)
  }

  const getSystemVoice = (voiceOption: VoiceOption): SpeechSynthesisVoice | null => {
    // First try exact language match
    let matchingVoices = availableVoices.filter(v => v.lang === voiceOption.lang)

    // If no exact match, try language prefix
    if (matchingVoices.length === 0) {
      matchingVoices = availableVoices.filter(v =>
        v.lang.startsWith(voiceOption.lang.split('-')[0])
      )
    }

    // Sort voices to prioritize certain characteristics
    const sortedVoices = matchingVoices.sort((a, b) => {
      // Prioritize Google voices as they tend to have better quality
      if (a.name.includes('Google') && !b.name.includes('Google')) return -1
      if (!a.name.includes('Google') && b.name.includes('Google')) return 1

      // Then prioritize Microsoft voices
      if (a.name.includes('Microsoft') && !b.name.includes('Microsoft')) return -1
      if (!a.name.includes('Microsoft') && b.name.includes('Microsoft')) return 1

      return 0
    })

    // For gender matching, look for specific voice names that typically indicate gender
    if (voiceOption.gender === 'male') {
      // Common male voice names
      const maleNames = ['David', 'James', 'Mark', 'Paul', 'Daniel', 'George', 'Richard', 'Christopher', 'Brian', 'Guy']
      const maleVoice = sortedVoices.find(v =>
        maleNames.some(name => v.name.includes(name)) ||
        v.name.toLowerCase().includes('male')
      )
      if (maleVoice) return maleVoice
    } else {
      // Common female voice names
      const femaleNames = ['Sarah', 'Emma', 'Samantha', 'Victoria', 'Kate', 'Susan', 'Linda', 'Karen', 'Zira', 'Hazel']
      const femaleVoice = sortedVoices.find(v =>
        femaleNames.some(name => v.name.includes(name)) ||
        v.name.toLowerCase().includes('female')
      )
      if (femaleVoice) return femaleVoice
    }

    // If no gender match found, return different voices based on index to ensure variety
    const voiceIndex = VOICE_OPTIONS.findIndex(v => v.id === voiceOption.id)
    return sortedVoices[voiceIndex % sortedVoices.length] || null
  }

  const selectedVoice = VOICE_OPTIONS.find(v => v.id === selectedVoiceId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="h-4 w-4" />
          Voice: {selectedVoice?.name.split(' ')[0] || 'Select'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Select Voice</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="space-y-1">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Male Voices
          </div>
          {VOICE_OPTIONS.filter(v => v.gender === 'male').map((voice) => {
            const systemVoice = getSystemVoice(voice)
            return (
              <DropdownMenuItem
                key={voice.id}
                onClick={() => handleVoiceSelect(voice.id)}
                className="cursor-pointer"
                disabled={!systemVoice}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={selectedVoiceId === voice.id ? 'font-semibold' : ''}>
                    {voice.name}
                  </span>
                  {selectedVoiceId === voice.id && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
              </DropdownMenuItem>
            )
          })}
        </div>

        <DropdownMenuSeparator />

        <div className="space-y-1">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Female Voices
          </div>
          {VOICE_OPTIONS.filter(v => v.gender === 'female').map((voice) => {
            const systemVoice = getSystemVoice(voice)
            return (
              <DropdownMenuItem
                key={voice.id}
                onClick={() => handleVoiceSelect(voice.id)}
                className="cursor-pointer"
                disabled={!systemVoice}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={selectedVoiceId === voice.id ? 'font-semibold' : ''}>
                    {voice.name}
                  </span>
                  {selectedVoiceId === voice.id && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const useVoiceSettings = () => {
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('female1')

  useEffect(() => {
    const savedVoiceId = localStorage.getItem('preferred-voice-id')
    if (savedVoiceId) {
      setSelectedVoiceId(savedVoiceId)
    }
  }, [])

  const getVoiceForSynthesis = useCallback((voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    const voiceOption = VOICE_OPTIONS.find(v => v.id === selectedVoiceId)
    if (!voiceOption) return voices[0] || null

    // Try to find a matching system voice
    const matchingVoices = voices.filter(v =>
      v.lang.startsWith(voiceOption.lang.split('-')[0])
    )

    const genderKeywords = voiceOption.gender === 'male'
      ? ['male', 'man', 'guy', 'david', 'james', 'daniel', 'george', 'mark', 'paul']
      : ['female', 'woman', 'girl', 'sarah', 'emma', 'samantha', 'victoria', 'kate', 'susan']

    const preferredVoice = matchingVoices.find(v =>
      genderKeywords.some(keyword =>
        v.name.toLowerCase().includes(keyword)
      )
    )

    return preferredVoice || matchingVoices[0] || voices[0] || null
  }, [selectedVoiceId])

  return { selectedVoiceId, setSelectedVoiceId, getVoiceForSynthesis }
}
