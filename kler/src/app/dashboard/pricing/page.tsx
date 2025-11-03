'use client'

import { useState, useEffect } from 'react'
import { Check, Zap, Crown, Rocket, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createSubscriptionCheckout, createCreditPackCheckout, getCreditBalance, createCustomerPortalSession } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [currentPlan, setCurrentPlan] = useState<string>('free')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    async function loadUserData() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        setUserId(user.id)
        try {
          const balance = await getCreditBalance(user.id)
          setCurrentPlan(balance.plan)
        } catch (error) {
          console.error('Failed to load credit balance:', error)
        }
      }
    }

    loadUserData()
  }, [])

  const handleSubscribe = async (plan: 'pro' | 'business') => {
    if (!userId) return

    setLoading(plan)
    try {
      const { url } = await createSubscriptionCheckout(
        userId,
        plan,
        `${window.location.origin}/dashboard/pricing?success=true`,
        `${window.location.origin}/dashboard/pricing?canceled=true`
      )
      window.location.href = url
    } catch (error) {
      console.error('Failed to create checkout:', error)
      alert('Failed to start checkout. Please try again.')
      setLoading(null)
    }
  }

  const handleBuyCreditPack = async (packSize: 'small' | 'medium' | 'large') => {
    if (!userId) return

    setLoading(packSize)
    try {
      const { url } = await createCreditPackCheckout(
        userId,
        packSize,
        `${window.location.origin}/dashboard/pricing?success=true`,
        `${window.location.origin}/dashboard/pricing?canceled=true`
      )
      window.location.href = url
    } catch (error) {
      console.error('Failed to create checkout:', error)
      alert('Failed to start checkout. Please try again.')
      setLoading(null)
    }
  }

  const handleManageSubscription = async () => {
    if (!userId) return

    setLoading('portal')
    try {
      const { url } = await createCustomerPortalSession(
        userId,
        `${window.location.origin}/dashboard/pricing`
      )
      window.location.href = url
    } catch (error) {
      console.error('Failed to open customer portal:', error)
      alert('Failed to open subscription portal. Please try again.')
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Choose Your Plan</h1>
        </div>

        {/* Subscription Plans */}
        <div className="mb-6">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Monthly Subscriptions</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Free Plan */}
            <div className="rounded-2xl border-2 border-gray-200 bg-white p-6">
              <div className="mb-4">
                <Zap className="h-10 w-10 text-gray-600" />
              </div>
              <h3 className="mb-2 text-2xl font-bold">Free</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">$0</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="mb-8 space-y-3">
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">50 credits per day</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Resets daily at midnight</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Access to all features</span>
                </li>
              </ul>
              {currentPlan === 'free' && (
                <Badge className="w-full justify-center bg-gray-100 text-gray-700">Current Plan</Badge>
              )}
            </div>

            {/* Pro Plan */}
            <div className="relative rounded-2xl border-2 border-black bg-white p-6 shadow-lg">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <Badge className="bg-black text-white">Most Popular</Badge>
              </div>
              <div className="mb-4">
                <Crown className="h-10 w-10 text-black" />
              </div>
              <h3 className="mb-2 text-2xl font-bold">Pro</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">$19</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="mb-8 space-y-3">
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">300 credits per day</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Resets daily at midnight</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Priority support</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Perfect for regular users</span>
                </li>
              </ul>
              {currentPlan === 'pro' ? (
                <Button
                  onClick={handleManageSubscription}
                  disabled={loading !== null}
                  variant="outline"
                  className="w-full"
                >
                  {loading === 'portal' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                  ) : (
                    'Manage Subscription'
                  )}
                </Button>
              ) : currentPlan === 'business' ? (
                <Button
                  onClick={handleManageSubscription}
                  disabled={loading !== null}
                  variant="outline"
                  className="w-full"
                >
                  {loading === 'portal' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                  ) : (
                    'Downgrade Plan'
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => handleSubscribe('pro')}
                  disabled={loading !== null}
                  className="w-full bg-black text-white hover:bg-black/90"
                >
                  {loading === 'pro' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                  ) : (
                    'Upgrade to Pro'
                  )}
                </Button>
              )}
            </div>

            {/* Business Plan */}
            <div className="rounded-2xl border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white p-6">
              <div className="mb-4">
                <Rocket className="h-10 w-10 text-purple-600" />
              </div>
              <h3 className="mb-2 text-2xl font-bold">Business</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">$39</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="mb-8 space-y-3">
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">750 credits per day</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Resets daily at midnight</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Priority support</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-5 w-5 shrink-0 text-green-500" />
                  <span className="text-sm text-gray-600">Perfect for heavy users</span>
                </li>
              </ul>
              {currentPlan === 'business' ? (
                <Button
                  onClick={handleManageSubscription}
                  disabled={loading !== null}
                  variant="outline"
                  className="w-full"
                >
                  {loading === 'portal' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                  ) : (
                    'Manage Subscription'
                  )}
                </Button>
              ) : currentPlan === 'pro' ? (
                <Button
                  onClick={handleManageSubscription}
                  disabled={loading !== null}
                  className="w-full bg-purple-600 text-white hover:bg-purple-700"
                >
                  {loading === 'portal' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                  ) : (
                    'Upgrade to Business'
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => handleSubscribe('business')}
                  disabled={loading !== null}
                  className="w-full bg-purple-600 text-white hover:bg-purple-700"
                >
                  {loading === 'business' ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                  ) : (
                    'Upgrade to Business'
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Credit Packs */}
        <div>
          <h2 className="mb-4 text-xl font-semibold text-gray-900">One-Time Credit Packs</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Small Pack */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-2 text-xl font-bold">Small Pack</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold">$5</span>
              </div>
              <p className="mb-4 text-sm text-gray-600">500 credits</p>
              <Button
                onClick={() => handleBuyCreditPack('small')}
                disabled={loading !== null}
                variant="outline"
                className="w-full"
              >
                {loading === 'small' ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  'Buy Now'
                )}
              </Button>
            </div>

            {/* Medium Pack */}
            <div className="rounded-xl border-2 border-black bg-white p-6 shadow-md">
              <h3 className="mb-2 text-xl font-bold">Medium Pack</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold">$15</span>
              </div>
              <p className="mb-4 text-sm text-gray-600">2,000 credits</p>
              <Button
                onClick={() => handleBuyCreditPack('medium')}
                disabled={loading !== null}
                className="w-full bg-black text-white hover:bg-black/90"
              >
                {loading === 'medium' ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  'Buy Now'
                )}
              </Button>
            </div>

            {/* Large Pack */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-2 text-xl font-bold">Large Pack</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold">$35</span>
              </div>
              <p className="mb-4 text-sm text-gray-600">5,000 credits</p>
              <Button
                onClick={() => handleBuyCreditPack('large')}
                disabled={loading !== null}
                variant="outline"
                className="w-full"
              >
                {loading === 'large' ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
                ) : (
                  'Buy Now'
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Credit Costs Info */}
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-lg font-semibold">How Credits Work</h3>
          <div className="space-y-1 text-sm text-gray-600">
            <p><strong>Base query:</strong> 5 credits</p>
            <p><strong>With documentation retrieval:</strong> +5 credits (10 total)</p>
            <p><strong>With GitHub tools:</strong> +10 credits (15 total)</p>
            <p><strong>Each additional tool:</strong> +3 credits</p>
          </div>
        </div>
      </div>
    </div>
  )
}
