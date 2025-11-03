'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Settings, LogOut, Crown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCurrentUser, signOut } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function Navbar() {
  const router = useRouter()
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser()
      setIsLoggedIn(!!user)
      if (user) {
        // Load profile from Supabase
        const { supabase } = await import('@/lib/supabase')
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (data) {
          setProfile(data)
        }
      }
    }
    checkAuth()
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    await signOut()
    setIsLoggedIn(false)
    setProfile(null)
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

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Left side: Logo + Nav links */}
          <div className="flex items-center gap-8">
            <img src="/logo.png" alt="Kler" className="h-12 w-auto" />
            <div className="hidden md:flex items-center gap-6">
              <Link href="#features" className="text-sm text-gray-600 hover:text-black">
                Features
              </Link>
              <Link href="#pricing" className="text-sm text-gray-600 hover:text-black">
                Pricing
              </Link>
            </div>
          </div>

          {/* Right side: Profile or Auth buttons */}
          <div className="flex items-center gap-4">
            {isLoggedIn && profile ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-black text-white text-xs font-medium">
                    {getInitials(profile.full_name)}
                  </div>
                  <span className="hidden md:block text-sm font-medium text-gray-900">
                    {profile.full_name || 'User'}
                  </span>
                  <ChevronUp className={cn(
                    "h-4 w-4 text-gray-400 transition-transform",
                    profileDropdownOpen && "rotate-180"
                  )} />
                </button>

                {profileDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-gray-200 bg-white shadow-lg">
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
                          router.push('/dashboard/settings')
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
            ) : (
              <div className="hidden md:flex items-center gap-4">
                <Link href="/login" className="text-sm text-gray-600 hover:text-black">
                  Log in
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="bg-black text-white hover:bg-gray-800">
                    Sign up <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
