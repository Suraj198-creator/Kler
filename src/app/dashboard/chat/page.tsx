'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Send, Paperclip, Mic, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import {
  createConversation,
  getMessages,
  saveMessage,
  updateConversationTitle,
  generateConversationTitle,
  getConversation,
  type Message,
  type Conversation
} from '@/lib/chat-db'
import { sendMessage as sendMessageToBackend } from '@/lib/api-client'

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [messageCounter, setMessageCounter] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  // Get user and load conversation
  useEffect(() => {
    async function loadUserAndConversation() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setUserId(user.id)

      // Check if there's a conversation ID in URL
      const convId = searchParams.get('id')

      if (convId) {
        // Load existing conversation
        setConversationId(convId)
        try {
          const conv = await getConversation(convId)
          setConversation(conv)

          const msgs = await getMessages(convId)
          setMessages(msgs)
          setMessageCounter(msgs.length)
        } catch (error) {
          console.error('Error loading messages:', error)
        }
      }
    }

    loadUserAndConversation()
  }, [searchParams, router])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || loading || !userId) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    try {
      let currentConvId = conversationId
      let currentConv = conversation

      // Create new conversation if this is the first message
      if (!currentConvId) {
        const title = generateConversationTitle(userMessage)
        const newConv = await createConversation(userId, title)
        currentConvId = newConv.id
        currentConv = newConv
        setConversationId(currentConvId)
        setConversation(newConv)

        // Update URL with conversation ID
        router.push(`/dashboard/chat?id=${currentConvId}`)
      }

      // Generate message IDs for backend reference
      const queryId = `q${messageCounter + 1}`
      const responseId = `${queryId}-r`

      // Save user message to database
      const savedUserMsg = await saveMessage(
        currentConvId,
        userId,
        'user',
        userMessage,
        null, // No summary for user messages
        queryId // Backend message ID
      )
      const updatedMessages = [...messages, savedUserMsg]
      setMessages(updatedMessages)

      // Send to backend API (backend handles AI processing and summarization)
      const backendResponse = await sendMessageToBackend(
        userMessage,
        userId,
        currentConvId
      )

      // Backend returns full response AND summary
      const savedAssistantMsg = await saveMessage(
        currentConvId,
        userId,
        'assistant',
        backendResponse.response,
        backendResponse.summary, // Summary from backend
        backendResponse.message_id // Backend message ID (e.g., "q1-r")
      )
      const finalMessages = [...updatedMessages, savedAssistantMsg]
      setMessages(finalMessages)
      setMessageCounter(messageCounter + 2)

      // Update conversation title if this is the first message
      if (messages.length === 0) {
        await updateConversationTitle(currentConvId, generateConversationTitle(userMessage))
      }

    } catch (error) {
      console.error('Error sending message:', error)
      alert('Failed to send message. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startNewChat = () => {
    setMessages([])
    setConversationId(null)
    setConversation(null)
    setInput('')
    setMessageCounter(0)
    router.push('/dashboard/chat')
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Kler Chat</h1>
            {conversation && messages.length > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {messages.length} messages
              </p>
            )}
          </div>
          <Button onClick={startNewChat} variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-gray-500">
              <p className="text-lg font-medium">Start a new conversation</p>
              <p className="mt-2 text-sm">Ask anything about API docs, SDKs, or code examples</p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-black text-white'
                    : 'bg-white text-gray-900 shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                {message.message_id && (
                  <p className="mt-1 text-xs opacity-50">ID: {message.message_id}</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center space-x-2">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                  <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 delay-100" />
                  <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 delay-200" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-white px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative flex items-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="mb-2 text-gray-500 hover:text-gray-700"
            >
              <Paperclip className="h-5 w-5" />
            </Button>

            <div className="flex-1 rounded-2xl border bg-white shadow-sm">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                className="min-h-[52px] resize-none border-0 px-4 py-3 focus-visible:ring-0"
                rows={1}
              />
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="mb-2 text-gray-500 hover:text-gray-700"
            >
              <Mic className="h-5 w-5" />
            </Button>

            <Button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              size="icon"
              className="mb-2 rounded-full bg-black hover:bg-gray-800 disabled:bg-gray-300"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}