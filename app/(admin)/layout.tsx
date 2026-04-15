'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase-browser'

const NAV_ITEMS = [
  { href: '/pipeline', label: 'Pipeline', icon: '📊' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/devis', label: 'Devis', icon: '📄' },
  { href: '/livraisons', label: 'Livraisons', icon: '📦' },
  { href: '/planning', label: 'Planning', icon: '🔧' },
  { href: '/sav', label: 'SAV', icon: '🎫' },
  { href: '/equipe', label: 'Équipe', icon: '👔' },
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
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top nav bar */}
      <header className="bg-gray-900 flex items-center h-12 shrink-0 px-4 gap-6">
        {/* Logo */}
        <Link href="/pipeline" className="flex items-center gap-2 shrink-0 mr-2">
          <span className="text-white font-bold text-sm">RENOV-R 91</span>
          <span className="text-gray-500 text-xs hidden sm:inline">CRM</span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-1 overflow-x-auto flex-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="text-gray-500 hover:text-white text-xs flex items-center gap-1.5 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden md:inline">Déconnexion</span>
        </button>
      </header>

      {/* Main content — takes all remaining height, no scroll on body */}
      <main className="flex-1 bg-gray-50 overflow-auto p-4">{children}</main>
    </div>
  )
}
