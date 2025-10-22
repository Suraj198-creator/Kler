// src/lib/api-client.ts

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface ChatRequest {
  message: string
  user_id: string
  conversation_id?: string
}

export interface ChatResponse {
  response: string
  summary: string  // Summary of the response from backend
  conversation_id: string
  message_id: string  // Backend message ID (e.g., "q1-r")
  tokens_used: number
}

export interface ApiError {
  detail: string
}

/**
 * Send a message to the backend and get AI response with summary
 */
export async function sendMessage(
  message: string,
  userId: string,
  conversationId?: string
): Promise<ChatResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        user_id: userId,
        conversation_id: conversationId
      } as ChatRequest)
    })

    if (!response.ok) {
      const error: ApiError = await response.json()
      throw new Error(error.detail || 'Failed to send message')
    }

    return await response.json() as ChatResponse
  } catch (error) {
    console.error('API Error:', error)
    throw error
  }
}

/**
 * Check if backend is healthy
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`)
    return response.ok
  } catch (error) {
    console.error('Health check failed:', error)
    return false
  }
}