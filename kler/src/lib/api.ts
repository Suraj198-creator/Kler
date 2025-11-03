const API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:8000'

export async function sendMessage(
  message: string,
  userId: string,
  conversationId?: string
): Promise<{ response: string; conversation_id: string; summary?: string; message_id?: string }> {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      user_id: userId,
      conversation_id: conversationId,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to send message')
  }

  return response.json()
}

export async function sendMessageStream(
  message: string,
  userId: string,
  onEvent: (event: {
    type: string
    content?: string
    tool_name?: string
    tool_id?: string
    tool_result?: string
    message_id?: string
    summary?: string
    full_response?: string
    turn?: number
    max_turns?: number
    completed?: boolean
    tools_used?: number
    query?: string
    sources?: Array<{
      title: string
      snippet: string
      score: number
    }>
    num_chunks?: number
    documentation_sources?: Array<{
      query: string
      sources: Array<{
        title: string
        snippet: string
        score: number
      }>
      num_chunks: number
    }>
  }) => void,
  conversationId?: string,
  docContext?: string
): Promise<void> {
  const response = await fetch(`${API_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      user_id: userId,
      conversation_id: conversationId,
      doc_context: docContext,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to send message')
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  if (!reader) {
    throw new Error('No response body')
  }

  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      // Add chunk to buffer
      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE events (events end with \n\n)
      const events = buffer.split('\n\n')

      // Keep the last incomplete event in the buffer
      buffer = events.pop() || ''

      // Process complete events
      for (const event of events) {
        const lines = event.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsedEvent = JSON.parse(data)
              console.log(`[FRONTEND SSE] ${Date.now()} - Event received:`, parsedEvent.type)
              onEvent(parsedEvent)
            } catch (e) {
              console.error('Failed to parse SSE event:', e)
              console.error('Problematic data:', data)
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Stream read error:', error)
    // Notify the event handler about the connection failure
    onEvent({
      type: 'error',
      content: 'Connection interrupted. The response may be incomplete. Please try again.',
      error_code: 'STREAM_ERROR'
    } as any)
  } finally {
    reader.releaseLock()
  }
}

export async function loadConversation(
  userId: string,
  conversationId: string,
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    summary?: string | null
    message_id?: string | null
  }>
): Promise<{ success: boolean; message: string; messages_loaded: number }> {
  const response = await fetch(`${API_URL}/api/load_conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      conversation_id: conversationId,
      messages,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to load conversation')
  }

  return response.json()
}

// Credit API functions
export async function getCreditBalance(userId: string): Promise<{
  balance: number
  monthly_allowance: number
  plan: string
  is_master: boolean
}> {
  const response = await fetch(`${API_URL}/api/credits/balance?user_id=${userId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch credit balance')
  }

  return response.json()
}

export async function getCreditHistory(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ transactions: Array<any> }> {
  const response = await fetch(
    `${API_URL}/api/credits/history?user_id=${userId}&limit=${limit}&offset=${offset}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    throw new Error('Failed to fetch credit history')
  }

  return response.json()
}

export async function getUsageStats(userId: string): Promise<{
  current_balance: number
  monthly_allowance: number
  plan: string
  credits_used_this_month: number
  credits_added_this_month: number
  usage_percentage: number
}> {
  const response = await fetch(`${API_URL}/api/credits/usage-stats?user_id=${userId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to fetch usage stats')
  }

  return response.json()
}

// Stripe API functions
export async function createSubscriptionCheckout(
  userId: string,
  plan: 'pro' | 'business',
  successUrl: string,
  cancelUrl: string
): Promise<{ session_id: string; url: string }> {
  const response = await fetch(`${API_URL}/api/stripe/create-subscription-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      plan,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to create checkout session')
  }

  return response.json()
}

export async function createCreditPackCheckout(
  userId: string,
  packSize: 'small' | 'medium' | 'large',
  successUrl: string,
  cancelUrl: string
): Promise<{ session_id: string; url: string }> {
  const response = await fetch(`${API_URL}/api/stripe/create-credit-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      pack_size: packSize,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to create credit pack checkout')
  }

  return response.json()
}

export async function createCustomerPortalSession(
  userId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const response = await fetch(`${API_URL}/api/stripe/portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: userId,
      return_url: returnUrl,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to create portal session')
  }

  return response.json()
}

// Documentation search function
export async function searchDocs(query: string): Promise<{
  results: Array<{
    id: string
    title: string
    snippet: string
    url: string
    doc_name: string
    content: string
  }>
}> {
  const response = await fetch(
    `${API_URL}/api/search-docs?query=${encodeURIComponent(query)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    throw new Error('Failed to search documentation')
  }

  return response.json()
}