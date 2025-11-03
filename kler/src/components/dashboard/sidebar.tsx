'use client'

import { Plus, History, Settings, CreditCard, X, PanelLeftClose, PanelLeftOpen, Search, LogOut, Crown, ChevronUp, ChevronDown as ChevronDownIcon, SquarePen, MoreVertical, Pin, Trash2, Edit2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { signOut } from '@/lib/supabase'
import type { Conversation, Profile } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useState, useRef, useEffect } from 'react'
import { CreditDisplay } from './credit-display'

interface SidebarProps {
  conversations: Conversation[]
  profile: Profile
  onNewChat: () => void
  onRefresh: () => void
  onClose?: () => void
  onToggleCollapse?: () => void
  onToggleExpand?: () => void
  onTitleChange?: (newTitle: string, conversationId: string) => void
  onOpenSettings?: () => void
  onDeleteConversation?: (conversationId: string) => void
  onPinConversation?: (conversationId: string, isPinned: boolean) => void
  isCollapsed?: boolean
}

export function Sidebar({
  conversations,
  profile,
  onNewChat,
  onRefresh,
  onClose,
  onToggleCollapse,
  onToggleExpand,
  onTitleChange,
  onOpenSettings,
  onDeleteConversation,
  onPinConversation,
  isCollapsed = false
}: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentConversationId = searchParams.get('conversation')
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [editingConvId, setEditingConvId] = useState<string | null>(null)
  const [editedTitle, setEditedTitle] = useState<string>('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [menuOpenConvId, setMenuOpenConvId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const menuRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})

  useEffect(() => {
    if (editingConvId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingConvId])

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [searchOpen])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false)
      }
      // Close conversation menus when clicking outside
      if (menuOpenConvId) {
        const menuRef = menuRefs.current[menuOpenConvId]
        if (menuRef && !menuRef.contains(event.target as Node)) {
          setMenuOpenConvId(null)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpenConvId])

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  const getInitials = (name: string | null) => {
    if (!name) return 'U'
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleSaveTitle = (convId: string, originalTitle: string) => {
    if (editedTitle.trim() && editedTitle !== originalTitle && onTitleChange) {
      onTitleChange(editedTitle.trim(), convId)
    }
    setEditingConvId(null)
    setEditedTitle('')
  }

  const handleKeyDown = (e: React.KeyboardEvent, convId: string, originalTitle: string) => {
    if (e.key === 'Enter') {
      handleSaveTitle(convId, originalTitle)
    } else if (e.key === 'Escape') {
      setEditingConvId(null)
      setEditedTitle('')
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  const handleRename = (conv: Conversation, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpenConvId(null)
    setEditingConvId(conv.id)
    setEditedTitle(conv.title)
  }

  const handlePin = (conv: Conversation, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpenConvId(null)
    if (onPinConversation) {
      onPinConversation(conv.id, conv.is_pinned)
    }
  }

  const handleDelete = (conv: Conversation, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuOpenConvId(null)
    if (confirm(`Are you sure you want to delete "${conv.title}"?`)) {
      if (onDeleteConversation) {
        onDeleteConversation(conv.id)
      }
    }
  }

  const toggleMenu = (convId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (menuOpenConvId === convId) {
      setMenuOpenConvId(null)
      setMenuPosition(null)
    } else {
      const button = e.currentTarget as HTMLElement
      const rect = button.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right
      })
      setMenuOpenConvId(convId)
    }
  }

  const filteredConversations = searchQuery
    ? conversations.filter(conv =>
        conv.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations

  // Collapsed view - only logo and profile
  if (isCollapsed && !onClose) {
    return (
      <aside className="flex h-full w-full flex-col border-r border-gray-200 bg-white items-center py-4">
        {/* Logo - acts as expand button on hover */}
        <div className="relative group mb-4">
          <button
            onClick={onToggleExpand}
            className="relative rounded-lg p-2 transition-all duration-200 hover:bg-gray-100"
            title="Expand sidebar"
          >
            {/* Logo - hides on hover */}
            <img
              src="/logo.png"
              alt="KlerAI"
              className="h-10 w-10 object-contain transition-opacity duration-200 group-hover:opacity-0"
            />
            {/* Expand icon - shows on hover */}
            <PanelLeftOpen className="absolute inset-0 m-auto h-6 w-6 text-gray-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Profile Avatar */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white text-sm font-medium hover:bg-black/90"
          >
            {getInitials(profile.full_name)}
          </button>

          {profileDropdownOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border border-gray-200 bg-white shadow-lg">
              <div className="p-2">
                {!profile.is_master && profile.plan_type === 'free' && (
                  <Link
                    href="/dashboard/upgrade"
                    onClick={() => setProfileDropdownOpen(false)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <Crown className="h-4 w-4" />
                    Upgrade Plan
                  </Link>
                )}

                <button
                  onClick={() => {
                    if (onOpenSettings) {
                      onOpenSettings()
                    }
                    setProfileDropdownOpen(false)
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>

                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-gray-200 bg-white">
      {/* Logo/Brand Section */}
      <div className="flex items-center justify-between p-4">
        {onClose ? (
          <>
            <img src="/logo.png" alt="KlerAI" className="h-10 w-auto" />
            <button onClick={onClose}>
              <X className="h-5 w-5" />
            </button>
          </>
        ) : (
          <>
            <Link href="/dashboard" className="hover:opacity-80 transition-opacity">
              <img src="/logo.png" alt="KlerAI" className="h-10 w-auto" />
            </Link>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="rounded-lg p-1.5 hover:bg-gray-100"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4 text-gray-600" />
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* New Chat Button */}
        <Button onClick={onNewChat} variant="ghost" className="mb-4 w-full justify-start hover:bg-gray-100">
          <SquarePen className="mr-2 h-4 w-4" />
          New Chat
        </Button>

        {/* History Button */}
        <Link
          href="/dashboard/history"
          className={cn(
            'mb-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer',
            pathname === '/dashboard/history'
              ? 'bg-gray-100 text-gray-900 font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          )}
        >
          <History className="h-4 w-4" />
          History
        </Link>

        {/* Search */}
        {searchOpen ? (
          <div className="mb-4 relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search chats..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <button
              onClick={() => {
                setSearchOpen(false)
                setSearchQuery('')
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="mb-4 flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 cursor-pointer"
          >
            <Search className="h-4 w-4" />
            Search chats
          </button>
        )}

        {/* Recent Conversations - Scrollable Carousel */}
        <div className="mb-6">
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase text-gray-500">
            {searchQuery ? `Results (${filteredConversations.length})` : 'Recent'}
          </h3>
          <div className="relative">
            {filteredConversations.length === 0 ? (
              <p className="px-2 py-3 text-sm text-gray-500">
                {searchQuery ? 'No chats found' : 'No conversations yet'}
              </p>
            ) : (
              <div
                className="space-y-1 overflow-y-auto overflow-x-visible pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400"
                style={{ maxHeight: '320px' }} // ~6 items at 50px each
              >
                {filteredConversations.map((conv) => {
                  const isActive = currentConversationId === conv.id
                  const isEditing = editingConvId === conv.id
                  const menuOpen = menuOpenConvId === conv.id

                  return (
                    <div key={conv.id} className="group relative">
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={editedTitle}
                          onChange={(e) => setEditedTitle(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, conv.id, conv.title)}
                          onBlur={() => handleSaveTitle(conv.id, conv.title)}
                          className="w-full rounded-lg px-3 py-2 text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-black"
                          placeholder="Chat title"
                        />
                      ) : (
                        <div className="relative">
                          <Link
                            href={`/dashboard?conversation=${conv.id}`}
                            onClick={(e) => {
                              // Prevent navigation if already on this conversation
                              if (isActive) {
                                e.preventDefault()
                              }
                            }}
                            className={cn(
                              "block rounded-lg px-3 py-2 pr-10 text-sm transition-colors cursor-pointer",
                              isActive
                                ? "bg-gray-100 text-gray-900"
                                : "text-gray-700 hover:bg-gray-50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {conv.is_pinned && (
                                <Pin className="h-3 w-3 text-yellow-600 fill-yellow-600 flex-shrink-0" />
                              )}
                              <div className="truncate">{conv.title}</div>
                            </div>
                          </Link>

                          {/* Three-dot menu button */}
                          <button
                            onClick={(e) => toggleMenu(conv.id, e)}
                            className={cn(
                              "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 transition-opacity",
                              "opacity-0 group-hover:opacity-100 hover:bg-gray-200",
                              menuOpen && "opacity-100 bg-gray-200"
                            )}
                            title="More options"
                          >
                            <MoreVertical className="h-4 w-4 text-gray-600" />
                          </button>

                          {/* Dropdown menu */}
                          {menuOpen && menuPosition && (
                            <div
                              ref={(el) => { menuRefs.current[conv.id] = el }}
                              className="fixed w-48 rounded-lg border border-gray-200 bg-white shadow-lg z-50"
                              style={{
                                top: `${menuPosition.top}px`,
                                right: `${menuPosition.right}px`
                              }}
                            >
                              <div className="py-1">
                                <button
                                  onClick={(e) => handleRename(conv, e)}
                                  className="flex w-full items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <Edit2 className="h-4 w-4" />
                                  Rename
                                </button>
                                <button
                                  onClick={(e) => handlePin(conv, e)}
                                  className="flex w-full items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  <Pin className="h-4 w-4" />
                                  {conv.is_pinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button
                                  onClick={(e) => handleDelete(conv, e)}
                                  className="flex w-full items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Credit Display - Fixed above profile */}
      <div className="border-t border-gray-200 p-4">
        <CreditDisplay userId={profile.id} />
      </div>

      {/* Profile Section */}
      <div className="p-4 pt-0">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50 transition-colors"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black text-white text-sm font-medium">
              {getInitials(profile.full_name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {profile.full_name || 'User'}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">{profile.plan_type}</p>
                {profile.is_master && (
                  <Badge variant="default" className="h-4 px-1 text-[10px]">
                    <Crown className="h-2.5 w-2.5" />
                  </Badge>
                )}
              </div>
            </div>
            <ChevronUp className={cn(
              "h-4 w-4 text-gray-400 transition-transform",
              profileDropdownOpen && "rotate-180"
            )} />
          </button>

          {profileDropdownOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-gray-200 bg-white shadow-lg">
              <div className="p-2">
                {!profile.is_master && profile.plan_type === 'free' && (
                  <Link
                    href="/dashboard/upgrade"
                    onClick={() => setProfileDropdownOpen(false)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <Crown className="h-4 w-4" />
                    Upgrade Plan
                  </Link>
                )}

                <button
                  onClick={() => {
                    if (onOpenSettings) {
                      onOpenSettings()
                    }
                    setProfileDropdownOpen(false)
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>

                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
