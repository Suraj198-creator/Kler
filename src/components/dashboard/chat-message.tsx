// src/components/dashboard/chat-message.tsx
'use client'

import { User, Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { useState, useEffect, useRef, memo } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js'
import type { Message } from '@/lib/types'
import { cn } from '@/lib/utils'
import 'highlight.js/styles/github-dark.css'

interface ChatMessageProps {
  message: Message
  isStreaming?: boolean
  renderKey?: number
}

function ChatMessageComponent({ message, isStreaming = false, renderKey = 0 }: ChatMessageProps) {
  const [html, setHtml] = useState('')
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  const highlightAppliedRef = useRef(false)
  const isUser = message.role === 'user'

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

  // Apply syntax highlighting and add copy buttons (only once per message)
  useEffect(() => {
    if (!html || !containerRef.current) return

    // If highlighting already applied and not explicitly re-rendering, skip
    if (highlightAppliedRef.current && renderKey === 0) return

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

    // Mark highlighting as applied
    highlightAppliedRef.current = true
  }, [html, message.id, renderKey])

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
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
          isUser ? 'bg-black text-white' : 'bg-white border border-gray-200'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {/* Documentation sources (only for assistant messages) */}
        {!isUser && message.documentation_sources && message.documentation_sources.length > 0 && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-medium text-blue-900">
                Documentation Used
              </span>
            </div>
            <div className="space-y-3">
              {message.documentation_sources.map((docMeta, idx) => (
                <div key={idx} className="space-y-2">
                  <p className="text-xs font-medium text-blue-800">
                    Query: {docMeta.query}
                  </p>
                  <div className="space-y-1.5">
                    {docMeta.sources.map((source, sourceIdx) => (
                      <div key={sourceIdx} className="rounded bg-white p-2 text-xs">
                        <p className="font-medium text-gray-900">{source.title}</p>
                        <p className="mt-1 text-gray-600">{source.snippet}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tool usage dropdowns (only for assistant messages) */}
        {!isUser && message.tools_used && message.tools_used.length > 0 && (
          <div className="mb-4 space-y-2">
            {message.tools_used.map((tool) => (
              <div key={tool.id} className="rounded-lg border border-gray-200 bg-gray-50">
                <button
                  onClick={() => toggleTool(tool.id)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-gray-100"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {tool.name}
                    </span>
                    <span className="text-xs text-green-600">✓</span>
                  </div>
                  {expandedTools.has(tool.id) ? (
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  )}
                </button>
                {expandedTools.has(tool.id) && tool.result && (
                  <div className="border-t border-gray-200 bg-white px-4 py-3">
                    <pre className="whitespace-pre-wrap text-xs text-gray-700">
                      {tool.result}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

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
  // Only re-render if message ID changes or renderKey changes
  return prevProps.message.id === nextProps.message.id &&
         prevProps.renderKey === nextProps.renderKey
})