// src/app/dashboard/layout.tsx
'use client'

import { Suspense, useContext } from 'react'
import { DashboardContent, ConversationContext } from './dashboard-content'

export const useConversationRefresh = () => {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error('useConversationRefresh must be used within DashboardLayout')
  }
  return context
}

export const useProfile = () => {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error('useProfile must be used within DashboardLayout')
  }
  return context.profile
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
  return (
    <div className="flex h-screen">
      <Suspense fallback={
        <div className="flex min-h-screen w-full items-center justify-center">
          <p>Loading...</p>
        </div>
      }>
        <DashboardContent>
          {children}
        </DashboardContent>
      </Suspense>
    </div>
  )
}
