'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGES = [
  { code: 'nouveau', label: 'Nouveau', color: '#3B82F6' },
  { code: 'contacte', label: 'Contact\u00e9', color: '#EAB308' },
  { code: 'visite', label: 'Visite', color: '#6366F1' },
  { code: 'devis_envoye', label: 'Devis envoy\u00e9', color: '#F97316' },
  { code: 'signe', label: 'Sign\u00e9', color: '#22C55E' },
  { code: 'commande', label: 'Command\u00e9', color: '#A855F7' },
  { code: 'livre', label: 'Livr\u00e9', color: '#8B5CF6' },
  { code: 'pose', label: 'Pos\u00e9', color: '#14B8A6' },
] as const

const SOURCE_COLORS: Record<string, string> = {
  leboncoin: 'bg-amber-50 text-amber-600 border border-amber-200/60',
  telephone: 'bg-blue-50 text-blue-600 border border-blue-200/60',
  email: 'bg-pink-50 text-pink-600 border border-pink-200/60',
  'bouche a oreille': 'bg-emerald-50 text-emerald-600 border border-emerald-200/60',
  site_web: 'bg-cyan-50 text-cyan-600 border border-cyan-200/60',
}

const SOURCE_OPTIONS = [
  { value: 'leboncoin', label: 'LeBonCoin' },
  { value: 'telephone', label: 'T\u00e9l\u00e9phone' },
  { value: 'email', label: 'Email' },
  { value: 'bouche a oreille', label: 'Bouche \u00e0 oreille' },
  { value: 'site_web', label: 'Site web' },
  { value: 'autre', label: 'Autre' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Commercial {
  id: string
  nom: string
  couleur: string
}

interface DevisItem {
  id: string
  reference: string | null
  status: string
  montant_ttc: number | null
  sent_at: string | null
  signed_at: string | null
  payment_status: string | null
}

interface PipelineClient {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  source: string | null
  notes: string | null
  pipeline_stage: string
  commercial_id: string | null
  created_at: string
  alerts: string[]
  montant_devis: number | null
  devis_count: number
  commerciaux: { nom: string; couleur: string } | null
  devis: DevisItem[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEUR(val: number): string {
  return Number(val).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function sourceLabel(source: string | null): string {
  if (!source) return ''
  const opt = SOURCE_OPTIONS.find((s) => s.value === source)
  return opt ? opt.label : source
}

// ---------------------------------------------------------------------------
// SVG Icons (inline, no emoji)
// ---------------------------------------------------------------------------

function IconPlus({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function IconClipboard({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
}

function IconClose({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function IconChevronLeft({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function IconChevronRight({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function IconChevronDown({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function IconTrendUp({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  )
}

function IconClock({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
      <circle cx="12" cy="12" r="10" strokeWidth={2} fill="none" />
    </svg>
  )
}

function IconStar({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

function IconUsers({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  )
}

function IconBell({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100">
            <IconClose />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nouveau lead form (shared between both modals)
// ---------------------------------------------------------------------------

function LeadForm({
  commerciaux,
  onSave,
  initial,
}: {
  commerciaux: Commercial[]
  onSave: () => void
  initial?: { nom?: string; telephone?: string; email?: string; source?: string; notes?: string }
}) {
  const [nom, setNom] = useState(initial?.nom || '')
  const [telephone, setTelephone] = useState(initial?.telephone || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [source, setSource] = useState(initial?.source || '')
  const [besoin, setBesoin] = useState(initial?.notes || '')
  const [commercialId, setCommercialId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (initial) {
      setNom(initial.nom || '')
      setTelephone(initial.telephone || '')
      setEmail(initial.email || '')
      setSource(initial.source || '')
      setBesoin(initial.notes || '')
    }
  }, [initial])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nom.trim()) { setError('Le nom est requis'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: nom.trim(),
          telephone: telephone.trim() || null,
          email: email.trim() || null,
          source: source || null,
          notes: besoin.trim() || null,
          pipeline_stage: 'nouveau',
          commercial_id: commercialId || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erreur lors de la creation')
      }
      onSave()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow bg-white'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Nom *</label>
        <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required className={inputClass} placeholder="M. Dupont" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">T\u00e9l\u00e9phone</label>
          <input type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} className={inputClass} placeholder="06 12 34 56 78" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="dupont@email.fr" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputClass}>
            <option value="">-- Choisir --</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Commercial</label>
          <select value={commercialId} onChange={(e) => setCommercialId(e.target.value)} className={inputClass}>
            <option value="">-- Aucun --</option>
            {commerciaux.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Besoin</label>
        <textarea value={besoin} onChange={(e) => setBesoin(e.target.value)} rows={3} className={inputClass} placeholder="Description du besoin client..." />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
      >
        {saving ? 'Enregistrement...' : 'Ajouter le lead'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Coller un message modal
// ---------------------------------------------------------------------------

function CollerMessageModal({
  open,
  onClose,
  commerciaux,
  onSave,
}: {
  open: boolean
  onClose: () => void
  commerciaux: Commercial[]
  onSave: () => void
}) {
  const [rawMessage, setRawMessage] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<{ nom?: string; telephone?: string; email?: string; source?: string; notes?: string } | null>(null)
  const [extractError, setExtractError] = useState('')

  function reset() {
    setRawMessage('')
    setExtracted(null)
    setExtractError('')
  }

  async function handleExtract() {
    if (!rawMessage.trim()) return
    setExtracting(true)
    setExtractError('')
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: rawMessage }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erreur extraction')
      }
      const data = await res.json()
      setExtracted(data)
    } catch (err) {
      setExtractError((err as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSaved() {
    reset()
    onSave()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Coller un message">
      {!extracted ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Collez le message du client ici</label>
            <textarea
              value={rawMessage}
              onChange={(e) => setRawMessage(e.target.value)}
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow bg-white"
              placeholder="Copiez-collez le message LeBonCoin, email ou SMS du client..."
            />
          </div>
          {extractError && <p className="text-red-600 text-sm">{extractError}</p>}
          <button
            onClick={handleExtract}
            disabled={extracting || !rawMessage.trim()}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
          >
            {extracting ? 'Extraction...' : 'Extraire les informations'}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 mb-4">Informations extraites. V\u00e9rifiez et compl\u00e9tez si n\u00e9cessaire :</p>
          <LeadForm commerciaux={commerciaux} onSave={handleSaved} initial={extracted} />
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Pipeline card
// ---------------------------------------------------------------------------

function PipelineCard({ client, onStageChange }: { client: PipelineClient; onStageChange: (id: string, newStage: string) => void }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const currentIndex = STAGES.findIndex((s) => s.code === client.pipeline_stage)
  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < STAGES.length - 1

  const hasAlerts = client.alerts.includes('a_contacter') || client.alerts.includes('a_relancer') || client.alerts.includes('relance_urgente')
  const isUrgent = client.alerts.includes('relance_urgente')

  return (
    <div
      className="bg-white rounded-xl border border-gray-100 p-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all duration-200 relative group"
      onClick={() => router.push(`/clients/${client.id}`)}
    >
      {/* Alert dot indicator */}
      {hasAlerts && (
        <span className={`absolute top-2.5 right-2.5 w-2 h-2 rounded-full ${isUrgent ? 'bg-red-500' : 'bg-amber-400'}`} />
      )}

      {/* Client name */}
      <p className="text-sm font-semibold text-gray-900 truncate pr-4">{client.nom}</p>

      {/* Besoin */}
      {client.notes && (
        <p className="text-xs text-gray-500 truncate mt-1 line-clamp-1">{client.notes}</p>
      )}

      {/* Montant */}
      {client.montant_devis != null && client.montant_devis > 0 && (
        <p className="text-sm font-semibold text-emerald-600 mt-1.5">{formatEUR(client.montant_devis)}</p>
      )}

      {/* Tags row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {/* Source pill */}
        {client.source && (
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${SOURCE_COLORS[client.source] || 'bg-gray-50 text-gray-500 border border-gray-200/60'}`}>
            {sourceLabel(client.source)}
          </span>
        )}

        {/* Alert pills - subtle, small text */}
        {client.alerts.includes('a_contacter') && (
          <span className="inline-flex items-center gap-1 text-[10px] text-red-600 font-medium">
            <span className="w-1 h-1 rounded-full bg-red-500" />
            A contacter
          </span>
        )}
        {client.alerts.includes('a_relancer') && !client.alerts.includes('relance_urgente') && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium">
            <span className="w-1 h-1 rounded-full bg-amber-500" />
            Relance
          </span>
        )}
        {client.alerts.includes('relance_urgente') && (
          <span className="inline-flex items-center gap-1 text-[10px] text-red-600 font-medium">
            <span className="w-1 h-1 rounded-full bg-red-500" />
            Urgent 7j+
          </span>
        )}
      </div>

      {/* Commercial */}
      {client.commerciaux && (
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: client.commerciaux.couleur || '#9CA3AF' }}
          />
          <span className="text-[11px] text-gray-400 truncate">{client.commerciaux.nom}</span>
        </div>
      )}

      {/* Stage navigation - shown on hover */}
      <div className="flex items-center justify-end gap-0.5 mt-2 pt-2 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          disabled={!canGoBack}
          onClick={(e) => {
            e.stopPropagation()
            if (canGoBack) onStageChange(client.id, STAGES[currentIndex - 1].code)
          }}
          className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title={canGoBack ? `Vers ${STAGES[currentIndex - 1].label}` : ''}
        >
          <IconChevronLeft className="w-3 h-3 text-gray-400" />
        </button>

        {/* Stage dropdown */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
            title="Changer l'etape"
          >
            <IconChevronDown className="w-3 h-3 text-gray-400" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
              <div className="absolute right-0 bottom-full mb-1 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 w-40">
                {STAGES.map((s) => (
                  <button
                    key={s.code}
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      if (s.code !== client.pipeline_stage) onStageChange(client.id, s.code)
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 transition-colors ${
                      s.code === client.pipeline_stage ? 'font-semibold text-gray-900' : 'text-gray-600'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          disabled={!canGoForward}
          onClick={(e) => {
            e.stopPropagation()
            if (canGoForward) onStageChange(client.id, STAGES[currentIndex + 1].code)
          }}
          className="p-1 rounded-md hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title={canGoForward ? `Vers ${STAGES[currentIndex + 1].label}` : ''}
        >
          <IconChevronRight className="w-3 h-3 text-gray-400" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat Card component
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  secondary,
  accentColor,
  icon,
}: {
  label: string
  value: React.ReactNode
  secondary?: React.ReactNode
  accentColor: string
  icon: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-shadow duration-200 relative overflow-hidden">
      {/* Left accent border */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: accentColor }} />
      {/* Icon */}
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      {/* Value */}
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {/* Secondary */}
      {secondary && (
        <div className="text-sm text-gray-500 mt-0.5">{secondary}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function StatsBar({ clients, commerciaux }: { clients: PipelineClient[]; commerciaux: Commercial[] }) {
  const stats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const dayOfWeek = now.getDay() || 7
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - dayOfWeek + 1)
    weekStart.setHours(0, 0, 0, 0)

    // Collect all signed devis this month / this week
    let caMonth = 0
    let caWeek = 0
    const caByCommercial: Record<string, number> = {}

    for (const client of clients) {
      for (const d of client.devis || []) {
        if (d.status !== 'signe' || !d.signed_at) continue
        const signedDate = new Date(d.signed_at)
        const montant = Number(d.montant_ttc) || 0

        if (signedDate >= monthStart) {
          caMonth += montant
          // Attribute to commercial
          if (client.commercial_id) {
            caByCommercial[client.commercial_id] = (caByCommercial[client.commercial_id] || 0) + montant
          }
        }
        if (signedDate >= weekStart) {
          caWeek += montant
        }
      }
    }

    // Devis en attente
    const devisEnAttente = clients.filter((c) => c.pipeline_stage === 'devis_envoye')
    const montantEnAttente = devisEnAttente.reduce((sum, c) => sum + (c.montant_devis || 0), 0)

    // Best seller
    let bestSeller: { nom: string; montant: number } | null = null
    for (const [commId, montant] of Object.entries(caByCommercial)) {
      if (!bestSeller || montant > bestSeller.montant) {
        const comm = commerciaux.find((c) => c.id === commId)
        if (comm) bestSeller = { nom: comm.nom, montant }
      }
    }

    // Leads a traiter
    const leadsNouveaux = clients.filter((c) => c.pipeline_stage === 'nouveau').length

    // Relances
    const relances = clients.filter(
      (c) => c.alerts.includes('a_relancer') || c.alerts.includes('relance_urgente')
    ).length

    return { caMonth, caWeek, devisEnAttente: devisEnAttente.length, montantEnAttente, bestSeller, leadsNouveaux, relances }
  }, [clients, commerciaux])

  return (
    <div className="px-6 pt-5 pb-2 shrink-0 space-y-3">
      {/* Main KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="CA Mois"
          value={<span className="text-emerald-600">{formatEUR(stats.caMonth)}</span>}
          accentColor="#10B981"
          icon={<IconTrendUp className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="CA Semaine"
          value={<span className="text-blue-600">{formatEUR(stats.caWeek)}</span>}
          accentColor="#3B82F6"
          icon={<IconTrendUp className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="En attente"
          value={
            <span className="text-amber-600">
              {stats.devisEnAttente}
              <span className="text-base font-normal text-gray-400 ml-1">devis</span>
            </span>
          }
          secondary={stats.montantEnAttente > 0 ? formatEUR(stats.montantEnAttente) : undefined}
          accentColor="#F59E0B"
          icon={<IconClock className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="Top vendeur"
          value={
            stats.bestSeller ? (
              <span className="text-gray-900 text-lg">{stats.bestSeller.nom}</span>
            ) : (
              <span className="text-gray-300">{'\u2014'}</span>
            )
          }
          secondary={stats.bestSeller ? formatEUR(stats.bestSeller.montant) : undefined}
          accentColor="#8B5CF6"
          icon={<IconStar className="w-3.5 h-3.5" />}
        />
      </div>

      {/* Compact alert pills row */}
      <div className="flex items-center gap-3 pl-1">
        {stats.leadsNouveaux > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="font-medium">{stats.leadsNouveaux}</span>
            <span className="text-gray-400">Nouveaux leads</span>
          </div>
        )}
        {stats.relances > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="font-medium">{stats.relances}</span>
            <span className="text-gray-400">Relances a faire</span>
          </div>
        )}
        {stats.leadsNouveaux === 0 && stats.relances === 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Aucune action en attente
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const [clients, setClients] = useState<PipelineClient[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [filterCommercial, setFilterCommercial] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNewLead, setShowNewLead] = useState(false)
  const [showColler, setShowColler] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const url = filterCommercial ? `/api/pipeline?commercial_id=${filterCommercial}` : '/api/pipeline'
      const [pipelineRes, commerciauxRes] = await Promise.all([
        fetch(url),
        fetch('/api/commerciaux'),
      ])
      if (pipelineRes.ok) setClients(await pipelineRes.json())
      if (commerciauxRes.ok) setCommerciaux(await commerciauxRes.json())
    } catch (err) {
      console.error('Erreur chargement pipeline:', err)
    } finally {
      setLoading(false)
    }
  }, [filterCommercial])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleStageChange(clientId: string, newStage: string) {
    // Optimistic update
    setClients((prev) =>
      prev.map((c) => (c.id === clientId ? { ...c, pipeline_stage: newStage } : c))
    )
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_stage: newStage }),
      })
      if (!res.ok) throw new Error('Erreur mise a jour')
      fetchData()
    } catch {
      fetchData()
    }
  }

  function handleLeadSaved() {
    setShowNewLead(false)
    setShowColler(false)
    fetchData()
  }

  // Group clients by stage
  const byStage: Record<string, PipelineClient[]> = {}
  for (const stage of STAGES) byStage[stage.code] = []
  for (const client of clients) {
    if (byStage[client.pipeline_stage]) {
      byStage[client.pipeline_stage].push(client)
    }
  }

  return (
    <div className="h-full flex flex-col -m-8 bg-gray-50/50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Pipeline</h1>
        <div className="flex items-center gap-2.5">
          {/* Commercial filter */}
          <select
            value={filterCommercial}
            onChange={(e) => setFilterCommercial(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-gray-700 transition-shadow"
          >
            <option value="">Tous les commerciaux</option>
            {commerciaux.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>

          {/* Coller un message */}
          <button
            onClick={() => setShowColler(true)}
            className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3.5 py-2 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all text-sm font-medium"
          >
            <IconClipboard className="w-4 h-4 text-gray-400" />
            Coller un message
          </button>

          {/* Nouveau lead */}
          <button
            onClick={() => setShowNewLead(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
          >
            <IconPlus className="w-4 h-4" />
            Nouveau lead
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && <StatsBar clients={clients} commerciaux={commerciaux} />}

      {/* Kanban board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Chargement du pipeline...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-3 p-6 pt-4 min-w-max h-full">
            {STAGES.map((stage) => {
              const stageClients = byStage[stage.code] || []
              return (
                <div key={stage.code} className="w-72 flex flex-col shrink-0">
                  {/* Column header */}
                  <div className="bg-white rounded-t-xl border border-gray-100 border-b-0 px-3.5 py-3 relative">
                    {/* Top color accent */}
                    <div
                      className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl"
                      style={{ backgroundColor: stage.color }}
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: stage.color }}
                        />
                        <span className="text-sm font-medium text-gray-900">{stage.label}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
                        {stageClients.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards container */}
                  <div className="flex-1 overflow-y-auto bg-white border border-gray-100 border-t-0 rounded-b-xl p-2 space-y-2">
                    {stageClients.length === 0 ? (
                      <p className="text-center text-xs text-gray-300 py-10">Aucun client</p>
                    ) : (
                      stageClients.map((client) => (
                        <PipelineCard key={client.id} client={client} onStageChange={handleStageChange} />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal open={showNewLead} onClose={() => setShowNewLead(false)} title="Nouveau lead">
        <LeadForm commerciaux={commerciaux} onSave={handleLeadSaved} />
      </Modal>

      <CollerMessageModal
        open={showColler}
        onClose={() => setShowColler(false)}
        commerciaux={commerciaux}
        onSave={handleLeadSaved}
      />
    </div>
  )
}
