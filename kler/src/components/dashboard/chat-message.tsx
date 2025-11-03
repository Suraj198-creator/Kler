// src/components/dashboard/chat-message.tsx
'use client'

import { User, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { useState, useEffect, useRef, memo } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import type { Message } from '@/lib/types'
import { cn } from '@/lib/utils'
import 'highlight.js/styles/github-dark.css'
import Image from 'next/image'

interface ChatMessageProps {
  message: Message
  isStreaming?: boolean
  renderKey?: number
  userFullName?: string
  userAvatarUrl?: string | null
}

function ChatMessageComponent({ message, isStreaming = false, renderKey = 0, userFullName, userAvatarUrl }: ChatMessageProps) {
  const [html, setHtml] = useState('')
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [expandedDocs, setExpandedDocs] = useState<Set<number>>(new Set())
  const [showProcessingDetails, setShowProcessingDetails] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isUser = message.role === 'user'

  // Debug logging for tools
  useEffect(() => {
    if (!isUser) {
      console.log('=== CHAT MESSAGE COMPONENT ===')
      console.log('message.id:', message.id)
      console.log('message.tools_used:', message.tools_used)
      console.log('message.documentation_sources:', message.documentation_sources)
    }
  }, [message.id, message.tools_used, message.documentation_sources, isUser])

  // Debug logging
  useEffect(() => {
    if (isUser) {
      console.log('ChatMessage user props:', { userFullName, userAvatarUrl, messageId: message.id })
    }
  }, [isUser, userFullName, userAvatarUrl, message.id])

  // Helper function to get user initials
  const getInitials = (name?: string) => {
    if (!name || name.trim() === '') return 'U'
    const trimmedName = name.trim()
    return trimmedName
      .split(' ')
      .filter(n => n.length > 0) // Filter out empty strings
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U' // Return 'U' if result is empty
  }

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev)
      if (newSet.has(toolId)) {
        newSet.delete(toolId)
      } else {
        newSet.add(toolId)
      }
      return newSet
    })
  }

  const toggleDoc = (docIndex: number) => {
    setExpandedDocs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(docIndex)) {
        newSet.delete(docIndex)
      } else {
        newSet.add(docIndex)
      }
      return newSet
    })
  }

  useEffect(() => {
    const renderMarkdown = async () => {
      marked.setOptions({
        breaks: true,
        gfm: true,
      })

      const rendered = await marked.parse(message.content)
      setHtml(rendered)
    }

    renderMarkdown()
  }, [message.content, message.id])

  // Apply syntax highlighting and add copy buttons
  useEffect(() => {
    if (!html || !containerRef.current) return

    const container = containerRef.current
    const preElements = container.querySelectorAll('pre')

    preElements.forEach((pre) => {
      const code = pre.querySelector('code')
      if (!code) return

      // Completely reset the code element
      // Remove all hljs classes
      const classes = Array.from(code.classList).filter(cls => !cls.startsWith('hljs'))
      code.className = classes.join(' ')

      // Remove inline styles that might interfere
      code.removeAttribute('data-highlighted')

      // Apply highlighting fresh
      hljs.highlightElement(code as HTMLElement)

      // Remove all existing copy button wrappers
      const existingWrappers = pre.querySelectorAll('.copy-btn-wrapper')
      existingWrappers.forEach(w => w.remove())

      // Make pre relative
      pre.style.position = 'relative'

      // Create button wrapper
      const wrapper = document.createElement('div')
      wrapper.className = 'copy-btn-wrapper'
      wrapper.style.cssText = 'position: absolute; top: 8px; right: 8px; z-index: 10;'

      // Create button
      const button = document.createElement('button')
      button.className = 'copy-code-btn'
      button.style.cssText = 'padding: 8px; background: #1f2937; color: white; border-radius: 8px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;'

      const copyIcon = `<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>`
      const checkIcon = `<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`

      button.innerHTML = copyIcon

      // Hover effect
      button.addEventListener('mouseenter', () => {
        button.style.background = '#374151'
      })
      button.addEventListener('mouseleave', () => {
        button.style.background = '#1f2937'
      })

      // Copy handler
      button.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()

        const codeText = code.textContent || ''
        await navigator.clipboard.writeText(codeText)

        // Show check icon
        button.innerHTML = checkIcon

        // Reset after 2 seconds
        setTimeout(() => {
          button.innerHTML = copyIcon
        }, 2000)
      })

      wrapper.appendChild(button)
      pre.appendChild(wrapper)
    })
  }, [html, message.id, renderKey, showProcessingDetails, expandedTools, expandedDocs])

  return (
    <div
      className={cn(
        'flex gap-4 px-4 py-6',
        isUser ? 'bg-white' : 'bg-gray-50'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg overflow-hidden',
          isUser ? 'bg-black text-white' : 'bg-white border border-gray-200'
        )}
      >
        {isUser ? (
          userAvatarUrl ? (
            <Image
              src={userAvatarUrl}
              alt={userFullName || 'User'}
              width={32}
              height={32}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-medium">
              {getInitials(userFullName)}
            </div>
          )
        ) : (
          <Image
            src="/logo.png"
            alt="Kler AI"
            width={32}
            height={32}
            className="h-full w-full object-contain p-1"
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {/* Compact Processing Summary (only for assistant messages with tools/docs) */}
        {!isUser && (message.tools_used?.length || message.documentation_sources?.length) ? (
          <div className="mb-3">
            <button
              onClick={() => setShowProcessingDetails(!showProcessingDetails)}
              className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                  <span className="font-medium text-gray-900">
                    {message.tools_used?.length || 0} tool{(message.tools_used?.length || 0) !== 1 ? 's' : ''} used
                  </span>
                </div>
                {message.documentation_sources?.length ? (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-gray-600">
                      {message.documentation_sources.length} doc{message.documentation_sources.length !== 1 ? 's' : ''} retrieved
                    </span>
                  </>
                ) : null}
              </div>
              {showProcessingDetails ? (
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
              )}
            </button>

            {/* Expanded Details */}
            {showProcessingDetails && (
              <div className="mt-2 space-y-2 animate-in slide-in-from-top-2 duration-200">
                {/* Documentation sources */}
                {message.documentation_sources && message.documentation_sources.length > 0 && (
                  <div className="space-y-1">
                    {message.documentation_sources.map((docMeta, idx) => (
                      <div key={idx} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                        <button
                          onClick={() => toggleDoc(idx)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-2 flex-1">
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>
                            <div className="flex-1">
                              <div className="text-xs font-medium text-gray-900">
                                {docMeta.query}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {docMeta.num_chunks} chunks from {docMeta.sources.length} sources
                              </div>
                            </div>
                          </div>
                          {expandedDocs.has(idx) ? (
                            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                          )}
                        </button>
                        {expandedDocs.has(idx) && (
                          <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="space-y-2">
                              {docMeta.sources.map((source, sourceIdx) => (
                                <div key={sourceIdx} className="rounded border border-gray-200 bg-white p-2 shadow-sm">
                                  {source.title && (
                                    <div className="text-xs font-semibold text-gray-900 mb-1">
                                      {source.title}
                                    </div>
                                  )}
                                  <div className="text-xs text-gray-700 leading-relaxed">
                                    {source.snippet}
                                  </div>
                                  <div className="text-xs text-blue-600 mt-1 font-medium">
                                    Relevance: {(source.score * 100).toFixed(1)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tool usage */}
                {message.tools_used && message.tools_used.length > 0 && (
                  <div className="space-y-1">
                    {message.tools_used.map((tool) => (
                      <div key={tool.id} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                        <button
                          onClick={() => toggleTool(tool.id)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                            <span className="text-xs font-medium text-gray-900">
                              {tool.name}
                            </span>
                          </div>
                          {expandedTools.has(tool.id) ? (
                            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                          )}
                        </button>
                        {expandedTools.has(tool.id) && tool.result && (
                          <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                            <pre className="whitespace-pre-wrap text-xs text-gray-700">
                              {tool.result}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <div
          ref={containerRef}
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Metadata (sources, etc.) */}
        {message.metadata?.sources && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.metadata.sources.map((source: string, i: number) => (
              <a key={i} href={source} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                Source {i + 1}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Memoize to prevent re-renders when parent state changes
export const ChatMessage = memo(ChatMessageComponent, (prevProps, nextProps) => {
  // Only re-render if message ID changes or renderKey changes or user profile changes
  return prevProps.message.id === nextProps.message.id &&
         prevProps.renderKey === nextProps.renderKey &&
         prevProps.userFullName === nextProps.userFullName &&
         prevProps.userAvatarUrl === nextProps.userAvatarUrl
})