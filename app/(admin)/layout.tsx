'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createBrowserSupabase } from '@/lib/supabase-browser'

const NAV_ITEMS = [
  { href: '/pipeline', label: 'Pipeline', icon: '📊' },
  { href: '/clients', label: 'Clients', icon: '👥' },
  { href: '/devis', label: 'Devis', icon: '📄' },
  { href: '/devis-claudus', label: 'Devis Claudus', icon: '⚡' },
  { href: '/taches', label: 'Tâches', icon: '✅' },
  { href: '/messagerie-lbc', label: 'Messages LBC', icon: '💬' },
  { href: '/telephonie', label: 'Téléphonie', icon: '📞' },
  { href: '/livraisons', label: 'Livraisons', icon: '📦' },
  { href: '/planning', label: 'Planning', icon: '📅' },
  { href: '/sav', label: 'SAV', icon: '🔧' },
  { href: '/equipe', label: 'Équipe', icon: '👔' },
  { href: '/activite', label: 'Activité', icon: '📋' },
  { href: '/qonto', label: 'Qonto', icon: '🏦' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [currentUser, setCurrentUser] = useState<{ nom: string; id: string } | null>(null)

  // Init theme from localStorage
  useEffect(() => {
    const saved = (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
    setTheme(saved)
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  // Fetch current user
  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => {
      if (d && d.nom) setCurrentUser(d)
    }).catch(() => {})
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
  }

  async function handleLogout() {
    const supabase = createBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top nav — adapts to theme */}
      <header
        className="shrink-0 relative z-30 border-b"
        style={{
          borderColor: 'var(--border-default)',
          background: theme === 'dark' ? 'rgba(8, 10, 18, 0.85)' : 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }}
      >
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
              <span className="font-bold text-sm tracking-tight" style={{ color: theme === 'dark' ? '#FFFFFF' : '#0F172A' }}>RENOV-R</span>
              <span className="gradient-text-cyan font-bold text-sm">91</span>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-hide">
            {NAV_ITEMS.map((item) => {
              // Active si URL exacte OU si c'est une sous-route (avec `/` après le prefix)
              // pour éviter que `/devis` matche aussi `/devis-claudus`.
              // Active si URL exacte OU si c'est une sous-route (avec `/` après le prefix)
              // pour éviter que `/devis` matche aussi `/devis-claudus`.
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href + '/'))
              const inactiveColor = theme === 'dark' ? '#8A92A6' : '#475569'
              const hoverColor = theme === 'dark' ? '#E8EAF2' : '#0F172A'
              const activeColor = theme === 'dark' ? '#67E8F9' : '#0891B2'
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all rounded"
                  style={{
                    background: isActive ? 'rgba(34, 211, 238, 0.1)' : 'transparent',
                    color: isActive ? activeColor : inactiveColor,
                    boxShadow: isActive ? '0 0 20px rgba(34, 211, 238, 0.15), 0 0 0 1px rgba(34, 211, 238, 0.3) inset' : undefined,
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = hoverColor }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = inactiveColor }}
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

          {/* Current user */}
          {currentUser && (
            <span
              className="shrink-0 ml-2 text-xs font-medium px-2 py-1 rounded"
              style={{
                color: theme === 'dark' ? '#67E8F9' : '#0891B2',
                background: 'rgba(34, 211, 238, 0.1)',
              }}
            >
              {currentUser.nom}
            </span>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="shrink-0 ml-2 w-8 h-8 flex items-center justify-center rounded transition-all"
            style={{ color: theme === 'dark' ? '#8A92A6' : '#475569' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#0891B2'; e.currentTarget.style.background = 'rgba(34, 211, 238, 0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = theme === 'dark' ? '#8A92A6' : '#475569'; e.currentTarget.style.background = 'transparent' }}
            title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="shrink-0 ml-1 w-8 h-8 flex items-center justify-center rounded transition-all"
            style={{ color: theme === 'dark' ? '#5A6278' : '#64748B' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#E11D48'; e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = theme === 'dark' ? '#5A6278' : '#64748B'; e.currentTarget.style.background = 'transparent' }}
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
