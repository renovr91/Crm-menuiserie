'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase-browser'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '□' },
  { href: '/devis', label: 'Devis', icon: '□' },
  { href: '/clients', label: 'Clients', icon: '□' },
  { href: '/messages', label: 'Messages', icon: '□' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gray-900 text-white">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold">Renov-R</h1>
              <span className="text-gray-500 text-sm">CRM Menuiserie</span>
            </div>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
                return (
                  <Link key={item.href} href={item.href}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}>
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <button onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800">
            Deconnexion
          </button>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
