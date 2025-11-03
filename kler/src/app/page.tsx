import Navbar from '@/components/landing/navbar'
import Hero from '@/components/landing/hero'
import ValueProp from '@/components/landing/value-prop'
import Features from '@/components/landing/features'
import Pricing from '@/components/landing/pricing'
import CTA from '@/components/landing/cta'
import Footer from '@/components/landing/footer'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-zinc-50 to-stone-100 relative">
      {/* Glossy overlay effect */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-transparent pointer-events-none"></div>

      {/* Subtle shine effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.8),transparent_50%)] pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.6),transparent_50%)] pointer-events-none"></div>

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <ValueProp />
        <Features />
        <Pricing />
        <CTA />
        <Footer />
      </div>
    </div>
  )
}