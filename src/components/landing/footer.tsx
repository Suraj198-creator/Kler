import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-black" />
              <span className="font-bold">Kler</span>
            </div>
            <p className="text-sm text-gray-600">
              AI-powered documentation assistant for developers
            </p>
          </div>

          <div>
            <h4 className="mb-4 font-semibold">Product</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li><Link href="#features" className="hover:text-black">Features</Link></li>
              <li><Link href="#pricing" className="hover:text-black">Pricing</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-semibold">Company</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li><Link href="#" className="hover:text-black">About</Link></li>
              <li><Link href="#" className="hover:text-black">Contact</Link></li>
              <li><Link href="#" className="hover:text-black">Privacy</Link></li>
              <li><Link href="#" className="hover:text-black">Terms</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-gray-200 pt-8 text-center text-sm text-gray-600">
          © 2025 Kler. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
