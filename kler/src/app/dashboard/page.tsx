'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatMessage } from '@/components/dashboard/chat-message'
import { ChatInput } from '@/components/dashboard/chat-input'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { sendMessageStream, loadConversation } from '@/lib/api'
import type { Message } from '@/lib/types'
import { Sparkles, Loader2, ArrowDown } from 'lucide-react'
import { marked } from 'marked'
import type { ToolUsage, DocumentationMetadata } from '@/lib/types'
import { useConversationRefresh, useProfile } from './layout'
import Image from 'next/image'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversationId = searchParams.get('conversation')
  const { refreshConversations } = useConversationRefresh()
  const profile = useProfile()

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
  const [showScrollButton, setShowScrollButton] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const loadedConversationRef = useRef<string | null>(null) // Track loaded conversation

  useEffect(() => {
    const loadData = async () => {
      // CRITICAL: Don't load conversation while streaming to prevent state reset
      if (loading) {
        console.log('Skipping conversation load - streaming in progress')
        return
      }

      const user = await getCurrentUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUserId(user.id)

      // Load conversation if ID provided and not already loaded
      if (conversationId) {
        // Skip if we've already loaded this conversation
        if (loadedConversationRef.current === conversationId) {
          console.log('Conversation already loaded, skipping')
          return
        }

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
            loadedConversationRef.current = conversationId // Mark as loaded
          } catch (error) {
            console.error('Failed to load conversation into backend:', error)
          }
        } else {
          // Empty conversation, mark as loaded
          loadedConversationRef.current = conversationId
        }
      } else {
        // New chat - clear messages and conversation ID
        setMessages([])
        setCurrentConversationId(null)
        loadedConversationRef.current = null // Reset loaded conversation tracker
        // Increment key to ensure clean state
        setMessagesLoadKey(prev => prev + 1)
      }
    }

    loadData()
  }, [conversationId, router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, toolsInUse])

  // Scroll detection for showing/hiding scroll-to-bottom button
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // Show button if user has scrolled up more than 200px from bottom
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200
      setShowScrollButton(!isNearBottom)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

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

  const handleSend = async (content: string, docContext?: string) => {
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

      // Local accumulators for tools and docs (to avoid closure issues)
      const toolsAccumulator: ToolUsage[] = []
      const docsAccumulator: DocumentationMetadata[] = []

      // Stream the response
      await sendMessageStream(
        content,
        userId,
        (event) => {
          console.log('SSE Event received:', event.type, event)
          switch (event.type) {
            case 'turn_start':
              console.log('Turn started:', event.turn)
              setCurrentTurn(event.turn || 0)
              setMaxTurns(event.max_turns || 15)
              break

            case 'turn_complete':
              console.log('Turn completed')
              // Turn completed, ready for next or done
              break

            case 'tool_start':
              console.log('Tool started:', event.tool_name, event.tool_id)
              const newTool = { id: event.tool_id!, name: event.tool_name!, status: 'running' as const }
              toolsAccumulator.push(newTool)
              setToolsInUse((prev) => [...prev, newTool])
              break

            case 'tool_complete':
              console.log('Tool completed:', event.tool_name, event.tool_id)
              // Update in accumulator
              const toolInAccumulator = toolsAccumulator.find(t => t.id === event.tool_id)
              if (toolInAccumulator) {
                toolInAccumulator.status = 'complete'
                toolInAccumulator.result = event.tool_result
              }
              // Update in state for UI
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
              const newDoc = {
                query: event.query || '',
                sources: event.sources || [],
                num_chunks: event.num_chunks || 0
              }
              docsAccumulator.push(newDoc)
              setDocumentationSources((prev) => [...prev, newDoc])
              console.log('Documentation sources updated, count:', docsAccumulator.length)
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
              // Handle insufficient credits error
              if ((event as any).error_code === 'INSUFFICIENT_CREDITS') {
                // Show error as an assistant message instead of console error
                const errorMessage: Message = {
                  id: `error-${Date.now()}-${Math.random()}`,
                  conversation_id: activeConversationId!,
                  role: 'assistant',
                  content: event.content || 'Insufficient credits',
                  created_at: new Date().toISOString(),
                }
                setMessages((prev) => [...prev, errorMessage])
                setLoading(false)
                setStreamingText('')
                setStreamingHtml('')
                return // Exit the stream handling
              }
              // For other errors, log to console
              console.error('Stream error:', event.content)
              break
          }
        },
        activeConversationId || undefined,
        docContext
      )

      // Add assistant message to UI with tool usage and documentation sources
      console.log('=== CREATING ASSISTANT MESSAGE ===')
      console.log('toolsAccumulator:', toolsAccumulator)
      console.log('toolsAccumulator (filtered complete):', toolsAccumulator.filter(t => t.status === 'complete'))
      console.log('docsAccumulator:', docsAccumulator)
      console.log('docsAccumulator.length:', docsAccumulator.length)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        conversation_id: activeConversationId!,
        role: 'assistant',
        content: fullResponse,
        summary: responseSummary,
        message_id: messageId,
        tools_used: toolsAccumulator.filter(t => t.status === 'complete'),
        documentation_sources: docsAccumulator.length > 0 ? docsAccumulator : undefined,
        created_at: new Date().toISOString(),
      }
      console.log('=== ASSISTANT MESSAGE CREATED ===')
      console.log('assistantMessage.tools_used:', assistantMessage.tools_used)
      console.log('assistantMessage.documentation_sources:', assistantMessage.documentation_sources)
      console.log('Full assistantMessage:', assistantMessage)

      // Save assistant message to DB
      await supabase.from('messages').insert([{
        conversation_id: activeConversationId!,
        user_id: userId,
        role: 'assistant',
        content: fullResponse,
        summary: responseSummary || null,
        message_id: messageId || null,
        tools_used: toolsAccumulator.filter(t => t.status === 'complete'),
        documentation_sources: docsAccumulator.length > 0 ? docsAccumulator : null,
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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto relative">
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
                userFullName={profile?.full_name || undefined}
                userAvatarUrl={profile?.avatar_url || null}
              />
            ))}
            {loading && (
              <div className="bg-gray-50">
                {/* Processing Bar - Always visible and expanded */}
                <div className="border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {toolsInUse.length > 0 ? 'Agent Working' : 'Initializing...'}
                        </span>
                        {currentTurn > 0 && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            Turn {currentTurn}/{maxTurns}
                          </span>
                        )}
                      </div>
                      {toolsInUse.length > 0 && (
                        <div className="text-xs text-gray-600 mt-0.5">
                          {toolsInUse.filter(t => t.status === 'complete').length}/{toolsInUse.length} tools completed
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tool Details - Always visible */}
                  <div className="px-4 pb-4 space-y-3">
                    {/* Show placeholder if no tools yet */}
                    {toolsInUse.length === 0 && documentationSources.length === 0 && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 bg-white/50 rounded-lg px-3 py-2 animate-pulse">
                        <div className="flex gap-1">
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce"></div>
                        </div>
                        <span>Analyzing your request...</span>
                      </div>
                    )}

                    {/* Tool usage indicators - More prominent */}
                    {toolsInUse.length > 0 && (
                      <div className="space-y-2">
                        {toolsInUse.map((tool) => (
                          <div
                            key={tool.id}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all",
                              tool.status === 'running'
                                ? "bg-blue-100 border-2 border-blue-300 shadow-sm animate-pulse"
                                : "bg-green-50 border-2 border-green-200"
                            )}
                          >
                            {tool.status === 'running' ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="text-blue-900">Executing: {tool.name}</div>
                                  <div className="text-xs text-blue-700 mt-0.5">Please wait...</div>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0"></div>
                                <div className="text-green-900">Completed: {tool.name}</div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Documentation sources - More prominent */}
                    {documentationSources.length > 0 && (
                      <div className="space-y-2">
                        {documentationSources.map((docMeta, idx) => (
                          <div key={idx} className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-3 shadow-sm">
                            <div className="flex items-start gap-2">
                              <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0 mt-1"></div>
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900 mb-1">
                                  Documentation Retrieved
                                </p>
                                <p className="text-xs text-gray-600 mb-2">
                                  Query: {docMeta.query}
                                </p>
                                <div className="space-y-1">
                                  {docMeta.sources.slice(0, 2).map((source, sourceIdx) => (
                                    <div key={sourceIdx} className="text-xs text-gray-600 flex items-start gap-1">
                                      <span className="flex-shrink-0">•</span>
                                      <span>{source.title || source.snippet.substring(0, 50)}...</span>
                                    </div>
                                  ))}
                                  {docMeta.sources.length > 2 && (
                                    <div className="text-xs text-gray-500 font-medium">
                                      +{docMeta.sources.length - 2} more sources
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Main Response Area */}
                <div className="px-4 py-6">
                  <div className="flex gap-4">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white overflow-hidden">
                      <Image
                        src="/logo.png"
                        alt="Kler AI"
                        width={32}
                        height={32}
                        className="h-full w-full object-contain p-1 animate-pulse"
                      />
                    </div>
                    <div className="flex-1">
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
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

      </div>

      {/* Scroll to Bottom Button - Fixed to viewport */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-8 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white shadow-lg hover:bg-gray-800 transition-all hover:scale-110 z-50"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="h-5 w-5" />
        </button>
      )}

      {/* Input Area */}
      <ChatInput onSend={handleSend} disabled={loading} />
    </div>
  )
}