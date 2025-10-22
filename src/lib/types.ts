export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  is_master: boolean
  plan_type: 'free' | 'starter' | 'pro'
  created_at: string
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export interface ToolUsage {
  id: string
  name: string
  status: 'running' | 'complete'
  result?: string
}

export interface DocumentationSource {
  title: string
  snippet: string
  score: number
}

export interface DocumentationMetadata {
  query: string
  sources: DocumentationSource[]
  num_chunks: number
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  summary?: string | null
  message_id?: string | null
  metadata?: any
  tools_used?: ToolUsage[]
  documentation_sources?: DocumentationMetadata[]
  created_at: string
}

export interface ChatRequest {
  message: string
  conversation_id?: string
  user_id: string
}

export interface ChatResponse {
  response: string
  conversation_id: string
  tokens_used?: number
}