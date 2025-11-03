// src/app/dashboard/layout.tsx
'use client'

import { useEffect, useState, createContext, useContext } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Header } from '@/components/dashboard/header'
import { Sidebar } from '@/components/dashboard/sidebar'
import { SettingsModal } from '@/components/dashboard/settings-modal'
import { getCurrentUser, getProfile, supabase } from '@/lib/supabase'
import type { Profile, Conversation } from '@/lib/types'

// Create context for refreshing conversations and controlling sidebar
const ConversationContext = createContext<{
  refreshConversations: () => Promise<void>
  collapseSidebar: () => void
  expandSidebar: () => void
  sidebarCollapsed: boolean
} | null>(null)

export const useConversationRefresh = () => {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error('useConversationRefresh must be used within DashboardLayout')
  }
  return context
}

export const useSidebarControl = () => {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error('useSidebarControl must be used within DashboardLayout')
  }
  return {
    collapseSidebar: context.collapseSidebar,
    expandSidebar: context.expandSidebar,
    sidebarCollapsed: context.sidebarCollapsed
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currentConversationTitle, setCurrentConversationTitle] = useState<string>('')

  useEffect(() => {
    const loadData = async () => {
      const user = await getCurrentUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data: profileData } = await getProfile(user.id)
      setProfile(profileData)

      // Load conversations
      const { data: conversationsData } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })

      setConversations(conversationsData || [])
      setLoading(false)
    }

    loadData()
  }, [router])

  // Track current conversation title from URL
  useEffect(() => {
    const conversationId = searchParams.get('conversation')
    if (conversationId && conversations.length > 0) {
      const currentConv = conversations.find(c => c.id === conversationId)
      setCurrentConversationTitle(currentConv?.title || '')
    } else {
      setCurrentConversationTitle('')
    }
  }, [searchParams, conversations])

  const handleNewChat = () => {
    router.push('/dashboard')
    setSidebarOpen(false)
  }

  const refreshConversations = async () => {
    if (!profile) return
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', profile.id)
      .order('updated_at', { ascending: false })

    setConversations(data || [])
  }

  const refreshProfile = async () => {
    console.log('refreshProfile called')
    const user = await getCurrentUser()
    if (!user) {
      console.log('No user found')
      return
    }

    console.log('Fetching profile for user:', user.id)
    const { data: profileData, error } = await getProfile(user.id)
    console.log('Profile data:', profileData, 'Error:', error)

    if (profileData) {
      setProfile(profileData)
      console.log('Profile updated in layout:', profileData.full_name)
    }
  }

  const handleTitleChange = async (newTitle: string, conversationIdToUpdate?: string) => {
    const conversationId = conversationIdToUpdate || searchParams.get('conversation')
    if (!conversationId) return

    try {
      // Update in database
      const { error } = await supabase
        .from('conversations')
        .update({ title: newTitle })
        .eq('id', conversationId)

      if (error) {
        console.error('Failed to update conversation title:', error)
        return
      }

      // Only update header title if it's the current conversation
      if (conversationId === searchParams.get('conversation')) {
        setCurrentConversationTitle(newTitle)
      }

      // Update conversations array directly without re-fetching to avoid re-render
      setConversations(prev =>
        prev.map(conv =>
          conv.id === conversationId
            ? { ...conv, title: newTitle }
            : conv
        )
      )
    } catch (error) {
      console.error('Error updating title:', error)
    }
  }

  const handlePinConversation = async (conversationId: string, currentPinStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('conversations')
        .update({ is_pinned: !currentPinStatus })
        .eq('id', conversationId)

      if (error) {
        console.error('Failed to pin/unpin conversation:', error)
        return
      }

      // Update local state
      setConversations(prev =>
        prev.map(conv =>
          conv.id === conversationId
            ? { ...conv, is_pinned: !currentPinStatus }
            : conv
        )
      )
    } catch (error) {
      console.error('Error pinning conversation:', error)
    }
  }

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      // Delete conversation from database
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId)

      if (error) {
        console.error('Failed to delete conversation:', error)
        return
      }

      // Remove from local state
      setConversations(prev => prev.filter(conv => conv.id !== conversationId))

      // If we're currently viewing this conversation, redirect to dashboard
      if (searchParams.get('conversation') === conversationId) {
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Error deleting conversation:', error)
    }
  }

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      {/* Desktop Sidebar - Full Height */}
      <div className={`hidden lg:block transition-all duration-300 ${sidebarCollapsed ? 'w-20' : 'w-64'}`}>
        <Sidebar
          conversations={conversations}
          profile={profile}
          onNewChat={handleNewChat}
          onRefresh={refreshConversations}
          onToggleCollapse={() => setSidebarCollapsed(true)}
          onToggleExpand={() => setSidebarCollapsed(false)}
          onTitleChange={handleTitleChange}
          onOpenSettings={() => setSettingsOpen(true)}
          onDeleteConversation={handleDeleteConversation}
          onPinConversation={handlePinConversation}
          isCollapsed={sidebarCollapsed}
        />
      </div>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 bg-white">
            <Sidebar
              conversations={conversations}
              profile={profile}
              onNewChat={handleNewChat}
              onRefresh={refreshConversations}
              onClose={() => setSidebarOpen(false)}
              onTitleChange={handleTitleChange}
              onOpenSettings={() => {
                setSettingsOpen(true)
                setSidebarOpen(false)
              }}
              onDeleteConversation={handleDeleteConversation}
              onPinConversation={handlePinConversation}
            />
          </div>
        </div>
      )}

      {/* Right Side - Header + Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Hide header on settings, history, billing, and pricing pages */}
        {!pathname.includes('/settings') && !pathname.includes('/history') && !pathname.includes('/billing') && !pathname.includes('/pricing') && (
          <Header
            profile={profile}
            onMenuClick={() => setSidebarOpen(true)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            conversationTitle={currentConversationTitle}
            onTitleChange={handleTitleChange}
          />
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <ConversationContext.Provider value={{
            refreshConversations,
            collapseSidebar: () => setSidebarCollapsed(true),
            expandSidebar: () => setSidebarCollapsed(false),
            sidebarCollapsed
          }}>
            {children}
          </ConversationContext.Provider>
        </main>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onProfileUpdate={refreshProfile}
      />
    </div>
  )
}