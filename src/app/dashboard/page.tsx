'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatMessage } from '@/components/dashboard/chat-message'
import { ChatInput } from '@/components/dashboard/chat-input'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { sendMessageStream, loadConversation } from '@/lib/api'
import type { Message } from '@/lib/types'
import { Sparkles, Loader2 } from 'lucide-react'
import { marked } from 'marked'
import type { ToolUsage, DocumentationMetadata } from '@/lib/types'
import { useConversationRefresh } from './layout'

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversationId = searchParams.get('conversation')
  const { refreshConversations } = useConversationRefresh()

  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string>('')
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState<string>('')
  const [streamingHtml, setStreamingHtml] = useState<string>('')
  const [toolsInUse, setToolsInUse] = useState<ToolUsage[]>([])
  const [documentationSources, setDocumentationSources] = useState<DocumentationMetadata[]>([])
  const [currentTurn, setCurrentTurn] = useState<number>(0)
  const [maxTurns, setMaxTurns] = useState<number>(15)
  const [messagesLoadKey, setMessagesLoadKey] = useState<number>(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loadData = async () => {
      const user = await getCurrentUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)

      // Load conversation if ID provided
      if (conversationId) {
        setCurrentConversationId(conversationId)

        const { data } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })

        if (data && data.length > 0) {
          setMessages(data)
          // Increment load key to force re-rendering of message components
          setMessagesLoadKey(prev => prev + 1)

          // Load conversation into backend memory
          try {
            await loadConversation(
              user.id,
              conversationId,
              data.map(msg => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
                summary: msg.summary || null,
                message_id: msg.message_id || null
              }))
            )
            console.log('Conversation loaded into backend')
          } catch (error) {
            console.error('Failed to load conversation into backend:', error)
          }
        }
      } else {
        // New chat - clear messages and conversation ID
        setMessages([])
        setCurrentConversationId(null)
        // Increment key to ensure clean state
        setMessagesLoadKey(prev => prev + 1)
      }
    }

    loadData()
  }, [conversationId, router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, toolsInUse])

  // Auto-submit prompt from landing page
  useEffect(() => {
    const promptFromUrl = searchParams.get('prompt')
    if (promptFromUrl && userId && !conversationId && messages.length === 0 && !loading) {
      // Remove prompt from URL
      router.replace('/dashboard', { scroll: false })
      // Submit the prompt
      handleSend(promptFromUrl)
    }
  }, [searchParams, userId, conversationId, messages.length, loading])

  const handleSend = async (content: string) => {
    if (!userId) return

    setLoading(true)
    setStreamingText('')
    setStreamingHtml('')
    setToolsInUse([])
    setDocumentationSources([])
    setCurrentTurn(0)
    setMaxTurns(15)

    try {
      let activeConversationId = currentConversationId

      // Create new conversation if this is the first message
      if (!activeConversationId) {
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({
            user_id: userId,
            title: content.slice(0, 50),
          })
          .select()
          .single()

        if (convError || !newConv) {
          throw new Error('Failed to create conversation')
        }

        activeConversationId = newConv.id
        setCurrentConversationId(activeConversationId)

        // Update URL with new conversation ID
        router.push(`/dashboard?conversation=${activeConversationId}`)

        // Refresh sidebar immediately
        await refreshConversations()
      }

      // Add user message to UI immediately
      const userMessage: Message = {
        id: Date.now().toString(),
        conversation_id: activeConversationId!,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMessage])

      // Save user message to DB
      await supabase.from('messages').insert([{
        conversation_id: activeConversationId!,
        user_id: userId,
        role: 'user',
        content,
      }])

      let fullResponse = ''
      let responseSummary = ''
      let messageId = ''

      // Stream the response
      await sendMessageStream(
        content,
        userId,
        (event) => {
          switch (event.type) {
            case 'turn_start':
              setCurrentTurn(event.turn || 0)
              setMaxTurns(event.max_turns || 15)
              break

            case 'turn_complete':
              // Turn completed, ready for next or done
              break

            case 'tool_start':
              setToolsInUse((prev) => [
                ...prev,
                { id: event.tool_id!, name: event.tool_name!, status: 'running' }
              ])
              break

            case 'tool_complete':
              setToolsInUse((prev) =>
                prev.map((tool) =>
                  tool.id === event.tool_id
                    ? { ...tool, status: 'complete' as const, result: event.tool_result }
                    : tool
                )
              )
              break

            case 'documentation_retrieved':
              // Add documentation sources as they come in
              console.log('Documentation retrieved event:', event)
              setDocumentationSources((prev) => [
                ...prev,
                {
                  query: event.query || '',
                  sources: event.sources || [],
                  num_chunks: event.num_chunks || 0
                }
              ])
              console.log('Documentation sources updated')
              break

            case 'text_delta':
              fullResponse += event.content || ''
              const newText = fullResponse
              setStreamingText(newText)
              // Render markdown for streaming text (synchronous)
              setStreamingHtml(marked.parse(newText) as string)
              break

            case 'done':
              fullResponse = event.full_response || fullResponse
              responseSummary = event.summary || ''
              messageId = event.message_id || ''
              break

            case 'error':
              console.error('Stream error:', event.content)
              break
          }
        },
        activeConversationId || undefined
      )

      // Add assistant message to UI with tool usage and documentation sources
      console.log('Creating assistant message with documentation sources:', documentationSources)
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        conversation_id: activeConversationId!,
        role: 'assistant',
        content: fullResponse,
        summary: responseSummary,
        message_id: messageId,
        tools_used: toolsInUse.filter(t => t.status === 'complete'),
        documentation_sources: documentationSources.length > 0 ? documentationSources : undefined,
        created_at: new Date().toISOString(),
      }
      console.log('Assistant message created:', assistantMessage)

      // Save assistant message to DB
      await supabase.from('messages').insert([{
        conversation_id: activeConversationId!,
        user_id: userId,
        role: 'assistant',
        content: fullResponse,
        summary: responseSummary || null,
        message_id: messageId || null,
      }])

      // Update conversation's updated_at timestamp
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeConversationId!)

      setMessages((prev) => [...prev, assistantMessage])
      setStreamingText('')
      setToolsInUse([])
      setDocumentationSources([])

      // IMPORTANT: Reload conversation into backend memory for next message
      // This ensures the backend has the full conversation history including this exchange
      try {
        const { data: allMessages } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', activeConversationId!)
          .order('created_at', { ascending: true })

        if (allMessages && allMessages.length > 0) {
          await loadConversation(
            userId,
            activeConversationId!,
            allMessages.map(msg => ({
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              summary: msg.summary || null,
              message_id: msg.message_id || null
            }))
          )
          console.log('Conversation reloaded into backend after message')
        }
      } catch (error) {
        console.error('Failed to reload conversation into backend:', error)
      }

      // Refresh sidebar to update conversation order
      await refreshConversations()
    } catch (error) {
      console.error('Error sending message:', error)
      // Show error to user
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        conversation_id: currentConversationId || '',
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMessage])
      setStreamingText('')
      setToolsInUse([])
      setDocumentationSources([])
    } finally {
      setLoading(false)
    }
  }

  const examplePrompts = [
    'How do I setup OAuth for Twitter Ads API?',
    'Show me Python code for AWS S3 upload',
    'Explain Stripe webhook signature verification',
    'How to implement LinkedIn API authentication?',
  ]

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="max-w-2xl text-center">
              <div className="mb-6 inline-flex items-center justify-center rounded-2xl bg-black p-4">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h2 className="mb-4 text-3xl font-bold text-gray-900">
                How can I help you today?
              </h2>
              <p className="mb-8 text-gray-600">
                Ask me anything about APIs, SDKs, or code examples
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {examplePrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(prompt)}
                    className="rounded-xl border border-gray-200 bg-white p-4 text-left text-sm text-gray-900 hover:border-gray-300 hover:shadow-md transition-all"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                renderKey={messagesLoadKey}
              />
            ))}
            {loading && (
              <div className="bg-gray-50 px-4 py-6">
                <div className="flex gap-4">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white">
                    <Sparkles className="h-4 w-4 animate-pulse" />
                  </div>
                  <div className="flex-1">
                    {/* Turn indicator */}
                    {currentTurn > 0 && (
                      <div className="mb-3 text-xs font-medium text-gray-500">
                        Turn {currentTurn} / {maxTurns}
                      </div>
                    )}

                    {/* Documentation sources (shown while streaming) */}
                    {documentationSources.length > 0 && (
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
                          {documentationSources.map((docMeta, idx) => (
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

                    {/* Tool usage indicators */}
                    {toolsInUse.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {toolsInUse.map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm"
                          >
                            {tool.status === 'running' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                            ) : (
                              <span className="text-green-600">✓</span>
                            )}
                            <span className="text-gray-900 font-medium">{tool.name}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Streaming text */}
                    {streamingText ? (
                      <div
                        className="prose prose-sm max-w-none text-gray-900"
                        dangerouslySetInnerHTML={{ __html: streamingHtml }}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                        <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <ChatInput onSend={handleSend} disabled={loading} />
    </div>
  )
}