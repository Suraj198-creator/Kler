'use client'

import { useEffect, useState } from 'react'
import { Zap, TrendingUp, Crown } from 'lucide-react'
import { getCreditBalance } from '@/lib/api'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface CreditDisplayProps {
  userId: string
  onCreditsUpdate?: (credits: number) => void
  className?: string
}

export function CreditDisplay({ userId, onCreditsUpdate, className }: CreditDisplayProps) {
  const [balance, setBalance] = useState<number>(0)
  const [plan, setPlan] = useState<string>('free')
  const [allowance, setAllowance] = useState<number>(100)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCredits = async () => {
    try {
      setError(null)
      const data = await getCreditBalance(userId)
      setBalance(data.balance)
      setPlan(data.plan)
      setAllowance(data.monthly_allowance)
      if (onCreditsUpdate) {
        onCreditsUpdate(data.balance)
      }
    } catch (err) {
      console.error('Failed to fetch credits:', err)
      setError('Failed to load credits')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCredits()
    // Refresh credits every 30 seconds
    const interval = setInterval(fetchCredits, 30000)
    return () => clearInterval(interval)
  }, [userId])

  const usagePercentage = (balance / allowance) * 100
  const isLow = usagePercentage < 20
  const isCritical = usagePercentage < 10

  // Error state UI
  if (error && !loading) {
    return (
      <div className={cn("rounded-xl border border-red-200 bg-red-50 p-4", className)}>
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium text-red-700">Credits Unavailable</span>
        </div>
        <p className="mb-3 text-xs text-red-600">
          Unable to load credit balance. Please check your backend configuration.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs"
          onClick={() => {
            setLoading(true)
            fetchCredits()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-4", className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className={cn(
            "h-4 w-4",
            isCritical ? "text-red-500" : isLow ? "text-orange-500" : "text-green-500"
          )} />
          <span className="text-sm font-medium text-gray-700">Credits</span>
        </div>
        {plan !== 'free' && (
          <Crown className="h-3.5 w-3.5 text-yellow-500" />
        )}
      </div>

      {/* Balance */}
      {loading ? (
        <div className="mb-2 h-8 w-20 animate-pulse rounded bg-gray-200" />
      ) : (
        <div className="mb-2">
          <div className="flex items-baseline gap-1">
            <span className={cn(
              "text-2xl font-bold",
              isCritical ? "text-red-600" : isLow ? "text-orange-600" : "text-gray-900"
            )}>
              {balance.toLocaleString()}
            </span>
            <span className="text-sm text-gray-500">/ {allowance.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={cn(
            "h-full transition-all duration-300",
            isCritical ? "bg-red-500" : isLow ? "bg-orange-500" : "bg-green-500"
          )}
          style={{ width: `${Math.min(usagePercentage, 100)}%` }}
        />
      </div>

      {/* Plan Info */}
      <div className="mb-3 flex items-center justify-between text-xs">
        <span className="capitalize text-gray-600">{plan} Plan</span>
        {plan === 'free' && (
          <span className="text-gray-500">Resets daily</span>
        )}
      </div>

      {/* Warning/Action */}
      {isLow && (
        <div className={cn(
          "mb-3 rounded-lg p-2 text-xs",
          isCritical ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-700"
        )}>
          {isCritical ? '⚠️ Credits almost depleted!' : '⚡ Running low on credits'}
        </div>
      )}

      {/* Upgrade/Buy Button */}
      {plan === 'free' ? (
        <Link href="/dashboard/pricing" className="block">
          <Button size="sm" className="w-full bg-black text-white hover:bg-black/90">
            <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
            Upgrade Plan
          </Button>
        </Link>
      ) : (
        <Link href="/dashboard/pricing" className="block">
          <Button size="sm" variant="outline" className="w-full text-xs">
            Buy More Credits
          </Button>
        </Link>
      )}
    </div>
  )
}
