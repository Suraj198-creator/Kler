'use client'

import { useState, useRef, useEffect } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Profile } from '@/lib/types'

interface HeaderProps {
  profile: Profile
  onMenuClick: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  conversationTitle?: string
  onTitleChange?: (newTitle: string) => void
}

export function Header({ profile, onMenuClick, sidebarCollapsed, onToggleSidebar, conversationTitle, onTitleChange }: HeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState(conversationTitle || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditedTitle(conversationTitle || '')
  }, [conversationTitle])

  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingTitle])

  const handleSaveTitle = () => {
    if (editedTitle.trim() && editedTitle !== conversationTitle && onTitleChange) {
      onTitleChange(editedTitle.trim())
    } else {
      // Reset to original if no change
      setEditedTitle(conversationTitle || '')
    }
    setIsEditingTitle(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      setEditedTitle(conversationTitle || '')
      setIsEditingTitle(false)
    }
  }

  const handleDoubleClick = () => {
    if (conversationTitle) {
      setIsEditingTitle(true)
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onMenuClick}
            className="lg:hidden flex-shrink-0"
          >
            <Menu className="h-5 w-5" />
          </Button>


          {/* Conversation Title - Editable */}
          {conversationTitle ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isEditingTitle ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSaveTitle}
                  className="flex-1 px-2 py-1 text-lg font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black min-w-0"
                  placeholder="Chat title"
                />
              ) : (
                <h1
                  className="text-lg font-semibold text-gray-900 truncate cursor-pointer hover:opacity-70 transition-opacity"
                  onDoubleClick={handleDoubleClick}
                  title="Double-click to edit"
                >
                  {conversationTitle}
                </h1>
              )}
            </div>
          ) : (
            <h1 className="text-lg font-semibold text-gray-500">New Chat</h1>
          )}
        </div>

      </div>
    </header>
  )
}