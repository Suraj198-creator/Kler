// src/components/dashboard/settings-modal.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, User, Lock, Bell, Trash2, Save, Upload } from 'lucide-react'
import { getCurrentUser, getProfile, supabase, signOut } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'

type TabType = 'account' | 'security' | 'preferences'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onProfileUpdate?: () => Promise<void>
}

export function SettingsModal({ isOpen, onClose, onProfileUpdate }: SettingsModalProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('account')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Account form
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')

  // Password form
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Preferences
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [productUpdates, setProductUpdates] = useState(true)

  useEffect(() => {
    if (isOpen) {
      loadProfile()
    }
  }, [isOpen])

  const loadProfile = async () => {
    const user = await getCurrentUser()
    if (!user) {
      router.push('/login')
      return
    }

    console.log('Loading profile for user:', user.id)
    setEmail(user.email || '')

    const { data: profileData, error } = await getProfile(user.id)
    console.log('Profile loaded:', profileData, 'Error:', error)

    if (profileData) {
      setProfile(profileData)
      setFullName(profileData.full_name || '')
      console.log('Current full_name:', profileData.full_name)
    }

    setLoading(false)
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const handleUpdateProfile = async () => {
    if (!profile) return

    setSaving(true)
    try {
      console.log('Updating profile with full_name:', fullName)
      console.log('Profile ID:', profile.id)

      // First, let's check if we can read the current profile
      const { data: checkData, error: checkError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profile.id)
        .single()

      console.log('Current profile in DB:', checkData, 'Check Error:', checkError)

      // Now try the update
      const { error, data: updateResult } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', profile.id)
        .select()

      console.log('Update result:', updateResult, 'Error:', error)

      if (error) {
        console.error('Supabase error details:', error)
        throw error
      }

      if (updateResult && updateResult.length === 0) {
        console.error('No rows updated - possible RLS policy issue')
        showMessage('error', 'Failed to update profile. Please check database permissions.')
        return
      }

      showMessage('success', 'Profile updated successfully!')
      await loadProfile()

      // Refresh profile in parent layout
      if (onProfileUpdate) {
        console.log('Calling onProfileUpdate')
        await onProfileUpdate()
      }
    } catch (error: any) {
      console.error('Error updating profile:', error)
      showMessage('error', error.message || 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      showMessage('error', 'Passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      showMessage('error', 'Password must be at least 8 characters')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      showMessage('success', 'Password changed successfully!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    const confirmation = prompt('Type "DELETE" to confirm account deletion:')
    if (confirmation !== 'DELETE') return

    if (!profile) return

    setSaving(true)
    try {
      // Delete user data
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profile.id)

      if (profileError) throw profileError

      // Sign out
      await signOut()
      router.push('/')
    } catch (error: any) {
      showMessage('error', error.message || 'Failed to delete account')
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const tabs = [
    { id: 'account' as TabType, label: 'Account', icon: User },
    { id: 'security' as TabType, label: 'Security', icon: Lock },
    { id: 'preferences' as TabType, label: 'Preferences', icon: Bell },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-4xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
            <p className="text-sm text-gray-600">Manage your account settings and preferences</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={cn(
              'mx-6 mt-4 rounded-xl p-4 text-sm',
              message.type === 'success'
                ? 'bg-green-50 text-green-800'
                : 'bg-red-50 text-red-800'
            )}
          >
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p>Loading settings...</p>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar Tabs */}
            <div className="w-56 border-r border-gray-200 p-4 overflow-y-auto">
              <nav className="space-y-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                        activeTab === tab.id
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {tab.label}
                    </button>
                  )
                })}
              </nav>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-2xl">
                {activeTab === 'account' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Account Information</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Update your account details and profile information
                      </p>
                    </div>

                    {/* Avatar */}
                    <div>
                      <label className="block text-sm font-medium text-gray-900">
                        Profile Picture
                      </label>
                      <div className="mt-2 flex items-center gap-4">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black text-2xl font-bold text-white">
                          {fullName
                            ? fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                            : 'U'}
                        </div>
                        <Button variant="outline" size="sm" disabled>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Photo
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-gray-500">
                        Photo upload coming soon
                      </p>
                    </div>

                    {/* Full Name */}
                    <div>
                      <label htmlFor="fullName" className="block text-sm font-medium text-gray-900">
                        Full Name
                      </label>
                      <Input
                        id="fullName"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Enter your full name"
                        className="mt-2"
                      />
                    </div>

                    {/* Email (Read-only) */}
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-900">
                        Email Address
                      </label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        disabled
                        className="mt-2 bg-gray-50"
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Contact support to change your email address
                      </p>
                    </div>

                    {/* Master Badge */}
                    {profile?.is_master && (
                      <div className="rounded-xl border-2 border-black bg-black p-4 text-white">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">⭐</span>
                          <div>
                            <p className="font-semibold">Master Account</p>
                            <p className="text-sm text-gray-300">
                              You have unlimited access to all features
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Plan Info */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">Current Plan</p>
                          <p className="mt-1 text-2xl font-bold capitalize text-gray-900">
                            {profile?.plan_type}
                          </p>
                        </div>
                        {!profile?.is_master && (
                          <Button
                            variant="default"
                            onClick={() => {
                              router.push('/dashboard/upgrade')
                              onClose()
                            }}
                          >
                            Upgrade
                          </Button>
                        )}
                      </div>
                    </div>

                    <Button
                      onClick={handleUpdateProfile}
                      disabled={saving}
                      className="w-full"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                )}

                {activeTab === 'security' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Security Settings</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Manage your password and security preferences
                      </p>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-6">
                      <h4 className="mb-4 text-lg font-semibold text-gray-900">
                        Change Password
                      </h4>

                      <div className="space-y-4">
                        <div>
                          <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-900">
                            Current Password
                          </label>
                          <Input
                            id="currentPassword"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Enter current password"
                            className="mt-2"
                          />
                        </div>

                        <div>
                          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-900">
                            New Password
                          </label>
                          <Input
                            id="newPassword"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Enter new password"
                            className="mt-2"
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            Must be at least 8 characters
                          </p>
                        </div>

                        <div>
                          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-900">
                            Confirm New Password
                          </label>
                          <Input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                            className="mt-2"
                          />
                        </div>

                        <Button
                          onClick={handleChangePassword}
                          disabled={saving || !newPassword || !confirmPassword}
                          className="w-full"
                        >
                          <Lock className="mr-2 h-4 w-4" />
                          {saving ? 'Updating...' : 'Update Password'}
                        </Button>
                      </div>
                    </div>

                    {/* Two-Factor Auth (Coming Soon) */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
                      <h4 className="mb-2 text-lg font-semibold text-gray-900">
                        Two-Factor Authentication
                      </h4>
                      <p className="mb-4 text-sm text-gray-600">
                        Add an extra layer of security to your account
                      </p>
                      <Button variant="outline" disabled>
                        Enable 2FA (Coming Soon)
                      </Button>
                    </div>
                  </div>
                )}

                {activeTab === 'preferences' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Preferences</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Customize your experience and notification settings
                      </p>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-6">
                      <h4 className="mb-4 text-lg font-semibold text-gray-900">
                        Email Notifications
                      </h4>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900">Email Notifications</p>
                            <p className="text-sm text-gray-600">
                              Receive email updates about your account
                            </p>
                          </div>
                          <button
                            onClick={() => setEmailNotifications(!emailNotifications)}
                            className={cn(
                              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                              emailNotifications ? 'bg-black' : 'bg-gray-200'
                            )}
                          >
                            <span
                              className={cn(
                                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                                emailNotifications ? 'translate-x-6' : 'translate-x-1'
                              )}
                            />
                          </button>
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900">Product Updates</p>
                            <p className="text-sm text-gray-600">
                              Get notified about new features and updates
                            </p>
                          </div>
                          <button
                            onClick={() => setProductUpdates(!productUpdates)}
                            className={cn(
                              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                              productUpdates ? 'bg-black' : 'bg-gray-200'
                            )}
                          >
                            <span
                              className={cn(
                                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                                productUpdates ? 'translate-x-6' : 'translate-x-1'
                              )}
                            />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Display Settings */}
                    <div className="rounded-xl border border-gray-200 bg-white p-6">
                      <h4 className="mb-4 text-lg font-semibold text-gray-900">
                        Display Settings
                      </h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-900">
                            Theme
                          </label>
                          <select className="mt-2 h-12 w-full rounded-xl border border-gray-300 px-4 text-sm">
                            <option>Light</option>
                            <option disabled>Dark (Coming Soon)</option>
                            <option disabled>System (Coming Soon)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Danger Zone */}
                <div className="mt-12 rounded-xl border-2 border-red-200 bg-red-50 p-6">
                  <div className="flex items-start gap-4">
                    <Trash2 className="mt-1 h-5 w-5 text-red-600" />
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-red-900">Danger Zone</h4>
                      <p className="mt-1 text-sm text-red-700">
                        Once you delete your account, there is no going back. All your data will be permanently removed.
                      </p>
                      <Button
                        onClick={handleDeleteAccount}
                        disabled={saving}
                        variant="outline"
                        className="mt-4 border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {saving ? 'Deleting...' : 'Delete Account'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
