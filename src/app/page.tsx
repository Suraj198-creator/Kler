import Navbar from '@/components/landing/navbar'
import Hero from '@/components/landing/hero'
import ValueProp from '@/components/landing/value-prop'
import Features from '@/components/landing/features'
import Pricing from '@/components/landing/pricing'
import CTA from '@/components/landing/cta'
import Footer from '@/components/landing/footer'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Navbar />
      <Hero />
      <ValueProp />
      <Features />
      <Pricing />
      <CTA />
      <Footer />
    </div>
  )
}