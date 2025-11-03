'use client'

import { useState, useRef, KeyboardEvent, useEffect } from 'react'
import { Send, Paperclip, Mic, BookOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { searchDocs } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  onSend: (message: string, docContext?: string) => void
  disabled?: boolean
}

interface DocResult {
  id: string
  title: string
  snippet: string
  url: string
  doc_name: string
  content: string
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [showDocSearch, setShowDocSearch] = useState(false)
  const [docResults, setDocResults] = useState<DocResult[]>([])
  const [isLoadingDocs, setIsLoadingDocs] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedDoc, setSelectedDoc] = useState<DocResult | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Detect slash command and check if selected doc reference was deleted
  useEffect(() => {
    const lastSlashIndex = message.lastIndexOf('/')

    // If no slash in message at all, clear everything
    if (lastSlashIndex === -1) {
      setShowDocSearch(false)
      setDocResults([])
      if (selectedDoc) {
        setSelectedDoc(null)
      }
      return
    }

    // Check if the last slash is part of a URL
    // Look at characters before the slash to determine if it's in a URL context
    const textBeforeSlash = message.slice(0, lastSlashIndex)
    const isInUrl = /(https?:\/\/[^\s]*|github\.com\/[^\s]*|gitlab\.com\/[^\s]*|bitbucket\.org\/[^\s]*)$/.test(textBeforeSlash)

    if (isInUrl) {
      setShowDocSearch(false)
      setDocResults([])
      if (selectedDoc) {
        setSelectedDoc(null)
      }
      return
    }

    // Get text after last "/"
    const textAfterSlash = message.slice(lastSlashIndex + 1)

    // If user typed something after "/" and pressed space (ends with space or has space in middle),
    // they don't want doc search - just a regular slash
    if (textAfterSlash.includes(' ')) {
      setShowDocSearch(false)
      setDocResults([])
      if (selectedDoc) {
        setSelectedDoc(null)
      }
      return
    }

    // Check if doc is selected and text has been modified
    if (selectedDoc) {
      const expectedText = `${selectedDoc.title} `

      // If the text after slash exactly matches the selected doc, keep it selected
      if (textAfterSlash === expectedText || textAfterSlash.startsWith(expectedText)) {
        setShowDocSearch(false)
        setDocResults([])
        return
      } else {
        // User modified the text, clear selection and show dropdown
        setSelectedDoc(null)
        // Continue to show dropdown below
      }
    }

    // Show dropdown for slash command
    if (textAfterSlash.length > 0) {
      setShowDocSearch(true)
      // Trigger debounced search
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(textAfterSlash.trim())
      }, 300)
    } else {
      // Just "/" typed, show placeholder
      setShowDocSearch(true)
      setDocResults([])
      setIsLoadingDocs(false)
    }
  }, [message, selectedDoc])

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [docResults])

  const performSearch = async (query: string) => {
    setIsLoadingDocs(true)
    try {
      const response = await searchDocs(query)
      setDocResults(response.results.slice(0, 5)) // Limit to 5 results
    } catch (error) {
      console.error('Doc search failed:', error)
      setDocResults([])
    } finally {
      setIsLoadingDocs(false)
    }
  }

  const selectDoc = (doc: DocResult) => {
    // Replace "/query" with "/{title} "
    const lastSlashIndex = message.lastIndexOf('/')
    const newMessage = message.slice(0, lastSlashIndex) + `/${doc.title} `

    // Update message first, then set selected doc
    setMessage(newMessage)

    // Store selected doc (do this after setting message to avoid race condition)
    setSelectedDoc(doc)

    setShowDocSearch(false)
    setDocResults([])
    setSelectedIndex(0)

    // Focus back on input
    textareaRef.current?.focus()
  }

  const handleSubmit = () => {
    if (!message.trim() || disabled) return

    // Send message with doc context if a doc was selected
    onSend(message, selectedDoc?.content)

    setMessage('')
    setSelectedDoc(null)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle dropdown navigation
    if (showDocSearch && docResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, docResults.length - 1))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        return
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (docResults[selectedIndex]) {
          selectDoc(docResults[selectedIndex])
        }
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setShowDocSearch(false)
        setDocResults([])
        return
      }
    }

    // Normal enter key handling
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

  // Check if doc reference is valid for highlighting
  const isDocValid = () => {
    if (!selectedDoc || !message.includes('/')) return false

    const lastSlashIndex = message.lastIndexOf('/')
    const textAfterSlash = message.slice(lastSlashIndex + 1)
    const expectedText = `${selectedDoc.title} `

    return textAfterSlash === expectedText || textAfterSlash.startsWith(expectedText)
  }

  const docValid = isDocValid()

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            {/* Backdrop for highlighting */}
            {docValid && selectedDoc && (
              <div
                className="pointer-events-none absolute left-0 top-0 w-full rounded-xl px-4 py-3 pr-24 text-sm whitespace-pre-wrap text-gray-900"
                style={{
                  minHeight: '48px',
                  maxHeight: '200px',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: '1.5',
                  fontFamily: 'inherit',
                  letterSpacing: 'normal',
                  zIndex: 1
                }}
              >
                {message.split(new RegExp(`(/${selectedDoc.title})`)).map((part, i) =>
                  part === `/${selectedDoc.title}` ? (
                    <span key={i} className="bg-blue-100 rounded">{part}</span>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Type your message or use / to search docs... (Shift+Enter for new line)"
              disabled={disabled}
              rows={1}
              className="relative w-full resize-none rounded-xl border border-gray-300 px-4 py-3 pr-24 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-2 focus:ring-black disabled:opacity-50"
              style={{
                minHeight: '48px',
                maxHeight: '200px',
                lineHeight: '1.5',
                color: docValid ? 'rgba(0, 0, 0, 0)' : '#111827',
                backgroundColor: docValid ? 'transparent' : 'white',
                caretColor: 'black',
                zIndex: 2,
                WebkitTextFillColor: docValid ? 'transparent' : '#111827'
              }}
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

            {/* Documentation Search Dropdown */}
            {showDocSearch && (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 bottom-full mb-2 rounded-lg border border-gray-200 bg-white shadow-lg z-50 max-h-80 overflow-y-auto"
              >
                {isLoadingDocs ? (
                  <div className="p-4 text-center text-sm text-gray-500">
                    <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
                    Searching documentation...
                  </div>
                ) : docResults.length > 0 ? (
                  <ul>
                    {docResults.map((doc, index) => (
                      <li
                        key={doc.id}
                        onClick={() => selectDoc(doc)}
                        className={cn(
                          "px-4 py-3 cursor-pointer border-b border-gray-100 last:border-0 transition-colors",
                          index === selectedIndex && "bg-gray-50"
                        )}
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {doc.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                            {doc.snippet}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-4 text-center text-sm text-gray-500">
                    Type to search 1000+ API docs
                  </div>
                )}
              </div>
            )}
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

        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Kler can make mistakes. Check important info.
          </p>
          {selectedDoc && (
            <p className="text-xs text-blue-600 flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              Using: {selectedDoc.title}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
