import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CTA() {
  return (
    <section className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-32 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="mb-8 text-5xl font-bold text-gray-900">
          Ready to build faster?
        </h2>
        <Link href="/signup">
          <Button size="lg" className="h-14 px-12 text-lg">
            Get Started <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </Link>
      </div>
    </section>
  )
}
