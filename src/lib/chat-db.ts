// src/lib/chat-db.ts
import { createClient } from '@/lib/supabase/client'

export type Message = {
  id: string
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  summary: string | null
  message_id: string | null
  created_at: string
}

export type Conversation = {
  id: string
  user_id: string
  title: string | null
  created_at: string
  updated_at: string
}

// Create a new conversation
export async function createConversation(userId: string, title?: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      title: title || 'New Chat'
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating conversation:', error)
    throw error
  }

  return data as Conversation
}

// Get all conversations for a user
export async function getConversations(userId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('Error fetching conversations:', error)
    throw error
  }

  return data as Conversation[]
}

// Get a single conversation
export async function getConversation(conversationId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()

  if (error) {
    console.error('Error fetching conversation:', error)
    throw error
  }

  return data as Conversation
}

// Get all messages in a conversation
export async function getMessages(conversationId: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching messages:', error)
    throw error
  }

  return data as Message[]
}

// Save a new message
export async function saveMessage(
  conversationId: string,
  userId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  summary?: string | null,
  messageId?: string | null
) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      summary: summary || null,
      message_id: messageId || null
    })
    .select()
    .single()

  if (error) {
    console.error('Error saving message:', error)
    throw error
  }

  return data as Message
}

// Update conversation title
export async function updateConversationTitle(conversationId: string, title: string) {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId)
    .select()
    .single()

  if (error) {
    console.error('Error updating conversation title:', error)
    throw error
  }

  return data as Conversation
}

// Delete a conversation (and all its messages due to CASCADE)
export async function deleteConversation(conversationId: string) {
  const supabase = createClient()

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)

  if (error) {
    console.error('Error deleting conversation:', error)
    throw error
  }
}

// Generate a title for a conversation based on the first message
export function generateConversationTitle(firstMessage: string): string {
  // Take first 50 characters or first sentence
  const truncated = firstMessage.slice(0, 50)
  const firstSentence = firstMessage.split(/[.!?]/)[0]

  if (firstSentence.length < 50 && firstSentence.length > 0) {
    return firstSentence.trim()
  }

  return truncated.trim() + (firstMessage.length > 50 ? '...' : '')
}

// Build context for backend API from database messages
export function buildContextForBackend(messages: Message[]): Array<{
  role: 'user' | 'assistant'
  content: string
  summary?: string
  message_id?: string
}> {
  return messages.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
    summary: msg.summary || undefined,
    message_id: msg.message_id || undefined
  }))
}