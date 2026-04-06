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
    <div className="min-h-screen flex">
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold">Renov-R</h1>
          <p className="text-gray-400 text-sm">CRM Menuiserie</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}>
                <span>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <button onClick={handleLogout} className="w-full text-left px-4 py-3 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">
            Deconnexion
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
