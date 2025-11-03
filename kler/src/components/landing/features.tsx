import { Target, Zap, BookOpen, Shield } from 'lucide-react'

export default function Features() {
  const features = [
    {
      icon: Target,
      title: 'Precise Answers',
      description: 'AI finds exact API methods and parameters you need'
    },
    {
      icon: Zap,
      title: 'Instant Results',
      description: 'Get code examples and setup guides in seconds'
    },
    {
      icon: BookOpen,
      title: '1000+ APIs & SDKs',
      description: 'Stripe, AWS, Twilio, MongoDB, and more'
    },
    {
      icon: Shield,
      title: 'Secure & Private',
      description: 'Your queries and code stay completely private'
    },
  ]

  return (
    <section id="features" className="px-4 py-32 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-16 text-center text-4xl font-bold text-gray-900">
          Why developers love Kler
        </h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <div
                key={i}
                className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
              >
                <Icon className="mb-4 h-10 w-10 text-black" />
                <h3 className="mb-2 text-xl font-bold text-gray-900">
                  {feature.title}
                </h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
