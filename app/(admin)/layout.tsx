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
  { href: '/qonto', label: 'Qonto', icon: '🏦' },
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
      {/* Top nav — glass dark */}
      <header className="shrink-0 relative z-30 border-b" style={{ borderColor: 'var(--border-default)', background: 'rgba(8, 10, 18, 0.85)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)' }}>
        <div className="flex items-center h-14 px-5 gap-1">
          {/* Logo */}
          <Link href="/pipeline" className="flex items-center gap-2 shrink-0 mr-6">
            <div className="relative">
              <div className="w-7 h-7 flex items-center justify-center rounded" style={{ background: 'linear-gradient(135deg, #22D3EE, #A855F7)' }}>
                <span className="text-white font-black text-xs">R</span>
              </div>
              <div className="absolute inset-0 rounded animate-pulse" style={{ boxShadow: '0 0 16px rgba(34, 211, 238, 0.5)' }} />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-white font-bold text-sm tracking-tight">RENOV-R</span>
              <span className="gradient-text-cyan font-bold text-sm">91</span>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-hide">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all rounded"
                  style={{
                    background: isActive ? 'rgba(34, 211, 238, 0.1)' : 'transparent',
                    color: isActive ? '#67E8F9' : '#8A92A6',
                    boxShadow: isActive ? '0 0 20px rgba(34, 211, 238, 0.15), 0 0 0 1px rgba(34, 211, 238, 0.3) inset' : undefined,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#E8EAF2' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#8A92A6' }}
                >
                  <span className="text-sm grayscale" style={{ filter: isActive ? 'none' : 'grayscale(1) opacity(0.7)' }}>{item.icon}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                  {isActive && (
                    <span className="absolute -bottom-px left-3 right-3 h-px" style={{ background: 'linear-gradient(90deg, transparent, #22D3EE, transparent)' }} />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="shrink-0 ml-3 w-8 h-8 flex items-center justify-center rounded transition-all"
            style={{ color: '#5A6278' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#FDA4AF'; e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#5A6278'; e.currentTarget.style.background = 'transparent' }}
            title="Déconnexion"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-5 relative z-10">{children}</main>
    </div>
  )
}
