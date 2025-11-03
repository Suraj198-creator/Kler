import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function Pricing() {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      period: '/month',
      features: [
        '10 queries per month',
        'Access to popular API docs',
        '7-day chat history',
        'Community support'
      ],
      cta: 'Start Free',
      variant: 'outline' as const
    },
    {
      name: 'Starter',
      price: '$25',
      period: '/month',
      badge: 'Most Popular',
      features: [
        '1,000 queries per month',
        'All API documentation',
        'Unlimited chat history',
        'Code export',
        'Email support'
      ],
      cta: 'Get Started',
      variant: 'default' as const
    },
    {
      name: 'Pro',
      price: '$60',
      period: '/month',
      features: [
        '3,000 queries per month',
        'Everything in Starter',
        'Priority support',
        'API access',
        'SSO integration'
      ],
      cta: 'Get Started',
      variant: 'default' as const
    },
  ]

  return (
    <section id="pricing" className="px-4 py-32 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-16 text-center text-4xl font-bold text-gray-900">
          Simple pricing
        </h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {plans.map((plan, i) => (
            <div
              key={i}
              className="relative rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
            >
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-black px-4 py-1 text-xs font-medium text-white">
                    {plan.badge}
                  </span>
                </div>
              )}

              <h3 className="mb-2 text-2xl font-bold">{plan.name}</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-gray-600">{plan.period}</span>
              </div>

              <ul className="mb-8 space-y-3">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link href="/signup">
                <Button variant={plan.variant} className="w-full">
                  {plan.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-gray-600">
          Pay as you go available
        </p>
      </div>
    </section>
  )
}
