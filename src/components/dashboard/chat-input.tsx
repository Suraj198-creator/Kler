'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { Send, Paperclip, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (!message.trim() || disabled) return

    onSend(message)
    setMessage('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)

    // Auto-resize textarea
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
  }

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Shift+Enter for new line)"
              disabled={disabled}
              rows={1}
              className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-24 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-2 focus:ring-black disabled:opacity-50"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />

            <div className="absolute bottom-2 right-2 flex gap-1">
              <button
                type="button"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Voice input"
              >
                <Mic className="h-4 w-4" />
              </button>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
            size="lg"
            className="h-12 px-6"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <p className="mt-2 text-xs text-gray-500">
          Kler can make mistakes. Check important info.
        </p>
      </div>
    </div>
  )
}