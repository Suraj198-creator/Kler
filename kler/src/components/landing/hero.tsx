'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BookText, Search, Code, Webhook, GitBranch, Database, BookOpen, Send } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { getCurrentUser, supabase } from '@/lib/supabase'
import type { Conversation } from '@/lib/types'

export default function Hero() {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    // Check if user is logged in and load conversations
    const checkAuth = async () => {
      const user = await getCurrentUser()
      setIsLoggedIn(!!user)
      if (user) {
        setUserId(user.id)
        // Load recent conversations
        const { data } = await supabase
          .from('conversations')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(6)

        setConversations(data || [])
      }
    }
    checkAuth()
  }, [])
  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!prompt.trim()) return

    if (isLoggedIn) {
      // Redirect to dashboard with prompt as query parameter
      router.push(`/dashboard?prompt=${encodeURIComponent(prompt.trim())}`)
    } else {
      // Redirect to login with prompt
      router.push(`/login?prompt=${encodeURIComponent(prompt.trim())}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  const handleExampleClick = (text: string) => {
    if (isLoggedIn) {
      router.push(`/dashboard?prompt=${encodeURIComponent(text)}`)
    } else {
      router.push(`/login?prompt=${encodeURIComponent(text)}`)
    }
  }

  const examplePrompts = [
    { icon: BookText, tag: '/docs', text: 'Setup Authentication for Twitter Ads API' },
    { icon: Search, tag: '/search', text: 'Stripe rate limits' },
    { icon: Code, tag: '/code', text: 'Python AWS S3 upload' },
    { icon: Webhook, tag: '/api', text: 'LinkedIn webhook signature' },
    { icon: GitBranch, tag: '/guide', text: 'Snowflake pipeline setup' },
    { icon: Database, tag: '/data', text: 'Compare MongoDB vs PostgreSQL' },
  ]

  return (
    <section className="px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          {/* Heading */}
          <h1 className="mb-4 text-7xl font-extrabold tracking-tight text-gray-900" style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif', letterSpacing: '-0.02em' }}>
            Kler
          </h1>

          <p className="mb-2 text-2xl font-medium text-gray-900">
            Stop context-switching. Start shipping.
          </p>

          <p className="mb-12 text-lg text-gray-600">
            AI that combines API docs and SDK context to generate integration code instantly
          </p>

          {/* Search Input */}
          <div className="mb-8">
            <form onSubmit={handleSubmit} className="relative mx-auto max-w-2xl">
              <Input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about APIs, SDKs, or code..."
                className="h-14 pr-14 shadow-lg"
              />
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 hover:bg-gray-100 transition-colors disabled:opacity-50"
                disabled={!prompt.trim()}
              >
                <Send className="h-5 w-5 text-gray-600" />
              </button>
            </form>
          </div>

          {/* Recent Chats or Example Prompts */}
          {isLoggedIn && conversations.length > 0 ? (
            <div>
              <h3 className="mb-4 text-sm font-semibold text-gray-700">Recent Chats</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/dashboard?conversation=${conv.id}`}
                    className="group rounded-xl border border-gray-200 bg-white p-4 text-left transition-all hover:shadow-md hover:-translate-y-1"
                  >
                    <p className="text-sm text-gray-900 truncate">{conv.title}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {examplePrompts.map((example, i) => {
                const Icon = example.icon
                return (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(example.text)}
                    className="group rounded-xl border border-gray-200 bg-white p-4 text-left transition-all hover:shadow-md hover:-translate-y-1"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-gray-600" />
                      <span className="text-xs font-medium text-gray-500">
                        {example.tag}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900">{example.text}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
