'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase-browser'

const NAV_ITEMS = [
  { href: '/pipeline', label: 'Pipeline', icon: '📊' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/devis', label: 'Devis', icon: '📄' },
  { href: '/livraisons', label: 'Livraisons', icon: '📦' },
  { href: '/planning', label: 'Planning', icon: '📅' },
  { href: '/sav', label: 'SAV', icon: '🔧' },
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
      {/* Top nav — dark, compact */}
      <header className="bg-gray-900 shrink-0">
        <div className="flex items-center h-12 px-4 gap-1">
          {/* Logo */}
          <Link href="/pipeline" className="flex items-center gap-1.5 shrink-0 mr-4">
            <span className="text-white font-bold text-sm tracking-tight">RENOV-R</span>
            <span className="text-blue-400 font-bold text-sm">91</span>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-0.5 overflow-x-auto flex-1 scrollbar-hide">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
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
            className="text-gray-500 hover:text-red-400 transition-colors shrink-0 ml-2"
            title="Déconnexion"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 bg-gray-50 overflow-auto p-4">{children}</main>
    </div>
  )
}
