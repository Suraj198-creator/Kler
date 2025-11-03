'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Pin, Trash2, FileText, Calendar, CheckSquare, Square } from 'lucide-react'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Conversation } from '@/lib/types'
import { format } from 'date-fns'

export default function HistoryPage() {
  const router = useRouter()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)

  useEffect(() => {
    loadConversations()
  }, [])

  useEffect(() => {
    if (searchQuery) {
      const filtered = conversations.filter(conv =>
        conv.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
      setFilteredConversations(filtered)
    } else {
      setFilteredConversations(conversations)
    }
  }, [searchQuery, conversations])

  const loadConversations = async () => {
    const user = await getCurrentUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    setConversations(data || [])
    setFilteredConversations(data || [])
    setLoading(false)
  }

  const handlePin = async (convId: string, isPinned: boolean) => {
    await supabase
      .from('conversations')
      .update({ is_pinned: !isPinned })
      .eq('id', convId)

    loadConversations()
  }

  const handleDelete = async (convId: string) => {
    if (!confirm('Are you sure you want to delete this conversation?')) return

    await supabase
      .from('conversations')
      .delete()
      .eq('id', convId)

    loadConversations()
  }

  const handleOpen = (convId: string) => {
    if (selectionMode) return // Don't open when in selection mode
    router.push(`/dashboard?conversation=${convId}`)
  }

  const toggleSelection = (convId: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(convId)) {
      newSelected.delete(convId)
    } else {
      newSelected.add(convId)
    }
    setSelectedIds(newSelected)

    // Exit selection mode if no items selected
    if (newSelected.size === 0) {
      setSelectionMode(false)
    }
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredConversations.length) {
      setSelectedIds(new Set())
      setSelectionMode(false)
    } else {
      setSelectedIds(new Set(filteredConversations.map(c => c.id)))
      setSelectionMode(true)
    }
  }

  const enterSelectionMode = () => {
    setSelectionMode(true)
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const handleBulkPin = async () => {
    const selectedConvs = conversations.filter(c => selectedIds.has(c.id))
    const shouldPin = selectedConvs.some(c => !c.is_pinned)

    await Promise.all(
      Array.from(selectedIds).map(convId =>
        supabase
          .from('conversations')
          .update({ is_pinned: shouldPin })
          .eq('id', convId)
      )
    )

    exitSelectionMode()
    loadConversations()
  }

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} conversation(s)?`)) return

    await Promise.all(
      Array.from(selectedIds).map(convId =>
        supabase
          .from('conversations')
          .delete()
          .eq('id', convId)
      )
    )

    exitSelectionMode()
    loadConversations()
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col bg-white">
        <div className="border-b border-gray-200 px-8 py-6">
          <h1 className="mb-4 text-3xl font-bold text-gray-900">Chat History</h1>
          <div className="relative max-w-xl">
            <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200"></div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-2 h-5 w-3/4 rounded bg-gray-200"></div>
                <div className="h-4 w-1/4 rounded bg-gray-200"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Separate pinned and unpinned
  const pinnedConvs = filteredConversations.filter(c => c.is_pinned)
  const unpinnedConvs = filteredConversations.filter(c => !c.is_pinned)

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-200 px-8 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Chat History</h1>

          {!selectionMode ? (
            <Button
              onClick={enterSelectionMode}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <CheckSquare className="h-4 w-4" />
              Select
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                {selectedIds.size} selected
              </span>
              <Button
                onClick={exitSelectionMode}
                variant="ghost"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Bulk Actions Bar */}
        {selectionMode && selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <Button
              onClick={toggleSelectAll}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {selectedIds.size === filteredConversations.length ? (
                <>
                  <CheckSquare className="h-4 w-4" />
                  Deselect All
                </>
              ) : (
                <>
                  <Square className="h-4 w-4" />
                  Select All
                </>
              )}
            </Button>

            <div className="ml-auto flex gap-2">
              <Button
                onClick={handleBulkPin}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Pin className="h-4 w-4" />
                {conversations.filter(c => selectedIds.has(c.id)).some(c => !c.is_pinned) ? 'Pin' : 'Unpin'}
              </Button>
              <Button
                onClick={handleBulkDelete}
                variant="outline"
                size="sm"
                className="gap-2 text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <FileText className="mb-4 h-12 w-12 text-gray-400" />
            <p className="text-lg text-gray-600">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
            <p className="text-sm text-gray-500">
              {searchQuery ? 'Try a different search term' : 'Start chatting to see your history here'}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Pinned Conversations */}
            {pinnedConvs.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase text-gray-500">
                  Pinned
                </h2>
                <div className="space-y-2">
                  {pinnedConvs.map((conv) => (
                    <ConversationCard
                      key={conv.id}
                      conversation={conv}
                      onOpen={() => handleOpen(conv.id)}
                      onPin={() => handlePin(conv.id, conv.is_pinned)}
                      onDelete={() => handleDelete(conv.id)}
                      selectionMode={selectionMode}
                      isSelected={selectedIds.has(conv.id)}
                      onToggleSelect={() => toggleSelection(conv.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* All Conversations */}
            {unpinnedConvs.length > 0 && (
              <div>
                <h2 className="mb-3 text-xs font-semibold uppercase text-gray-500">
                  All Conversations
                </h2>
                <div className="space-y-2">
                  {unpinnedConvs.map((conv) => (
                    <ConversationCard
                      key={conv.id}
                      conversation={conv}
                      onOpen={() => handleOpen(conv.id)}
                      onPin={() => handlePin(conv.id, conv.is_pinned)}
                      onDelete={() => handleDelete(conv.id)}
                      selectionMode={selectionMode}
                      isSelected={selectedIds.has(conv.id)}
                      onToggleSelect={() => toggleSelection(conv.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ConversationCard({
  conversation,
  onOpen,
  onPin,
  onDelete,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  conversation: Conversation
  onOpen: () => void
  onPin: () => void
  onDelete: () => void
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}) {
  const handleClick = () => {
    if (selectionMode) {
      onToggleSelect()
    } else {
      onOpen()
    }
  }

  return (
    <div
      className={`group flex items-center gap-4 rounded-xl border p-4 transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
      }`}
    >
      {selectionMode && (
        <button
          onClick={onToggleSelect}
          className="flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-blue-600" />
          ) : (
            <Square className="h-5 w-5 text-gray-400" />
          )}
        </button>
      )}

      <button
        onClick={handleClick}
        className="flex-1 text-left"
      >
        <h3 className="mb-1 font-medium text-gray-900 group-hover:text-black">
          {conversation.title}
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Calendar className="h-3 w-3" />
          {format(new Date(conversation.updated_at), 'MMM d, yyyy')}
        </div>
      </button>

      {!selectionMode && (
        <div className="flex items-center gap-2">
          <button
            onClick={onPin}
            className={`rounded-lg p-2 transition-colors ${
              conversation.is_pinned
                ? 'text-yellow-600 hover:bg-yellow-50'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
            title={conversation.is_pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className="h-4 w-4" fill={conversation.is_pinned ? 'currentColor' : 'none'} />
          </button>

          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}