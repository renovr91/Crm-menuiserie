'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGES = [
  { code: 'nouveau', label: 'Nouveau', bg: 'bg-blue-50', header: 'bg-blue-500', text: 'text-blue-700' },
  { code: 'contacte', label: 'Contact\u00e9', bg: 'bg-yellow-50', header: 'bg-yellow-500', text: 'text-yellow-700' },
  { code: 'visite', label: 'Visite', bg: 'bg-indigo-50', header: 'bg-indigo-500', text: 'text-indigo-700' },
  { code: 'devis_envoye', label: 'Devis envoy\u00e9', bg: 'bg-orange-50', header: 'bg-orange-500', text: 'text-orange-700' },
  { code: 'signe', label: 'Sign\u00e9', bg: 'bg-green-50', header: 'bg-green-500', text: 'text-green-700' },
  { code: 'commande', label: 'Command\u00e9', bg: 'bg-purple-50', header: 'bg-purple-500', text: 'text-purple-700' },
  { code: 'livre', label: 'Livr\u00e9', bg: 'bg-violet-50', header: 'bg-violet-500', text: 'text-violet-700' },
  { code: 'pose', label: 'Pos\u00e9', bg: 'bg-teal-50', header: 'bg-teal-500', text: 'text-teal-700' },
] as const

const SOURCE_COLORS: Record<string, string> = {
  leboncoin: 'bg-amber-100 text-amber-800',
  telephone: 'bg-blue-100 text-blue-800',
  email: 'bg-pink-100 text-pink-800',
  'bouche a oreille': 'bg-green-100 text-green-800',
  site_web: 'bg-cyan-100 text-cyan-800',
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
// Modal wrapper
// ---------------------------------------------------------------------------

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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

  const inputClass = 'w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
        <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} required className={inputClass} placeholder="M. Dupont" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">T\u00e9l\u00e9phone</label>
          <input type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} className={inputClass} placeholder="06 12 34 56 78" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="dupont@email.fr" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputClass}>
            <option value="">-- Choisir --</option>
            {SOURCE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Commercial</label>
          <select value={commercialId} onChange={(e) => setCommercialId(e.target.value)} className={inputClass}>
            <option value="">-- Aucun --</option>
            {commerciaux.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Besoin</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Collez le message du client ici</label>
            <textarea
              value={rawMessage}
              onChange={(e) => setRawMessage(e.target.value)}
              rows={8}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Copiez-collez le message LeBonCoin, email ou SMS du client..."
            />
          </div>
          {extractError && <p className="text-red-600 text-sm">{extractError}</p>}
          <button
            onClick={handleExtract}
            disabled={extracting || !rawMessage.trim()}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
          >
            {extracting ? 'Extraction...' : 'Extraire'}
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

  return (
    <div
      className="bg-white rounded-lg shadow-sm border p-3.5 cursor-pointer hover:shadow-md transition-shadow relative group"
      onClick={() => router.push(`/clients/${client.id}`)}
    >
      {/* Name */}
      <p className="font-semibold text-sm text-gray-900 truncate">{client.nom}</p>

      {/* Besoin */}
      {client.notes && (
        <p className="text-xs text-gray-500 truncate mt-1">{client.notes}</p>
      )}

      {/* Montant */}
      {client.montant_devis != null && client.montant_devis > 0 && (
        <p className="text-xs font-medium text-green-600 mt-1.5">{formatEUR(client.montant_devis)}</p>
      )}

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {/* Source */}
        {client.source && (
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${SOURCE_COLORS[client.source] || 'bg-gray-100 text-gray-600'}`}>
            {sourceLabel(client.source)}
          </span>
        )}

        {/* Alerts */}
        {client.alerts.includes('a_contacter') && (
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">\u00c0 contacter</span>
        )}
        {client.alerts.includes('a_relancer') && (
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Relance</span>
        )}
        {client.alerts.includes('relance_urgente') && (
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">Urgent 7j+</span>
        )}
      </div>

      {/* Commercial */}
      {client.commerciaux && (
        <p className="text-[11px] text-gray-400 mt-2 truncate">{client.commerciaux.nom}</p>
      )}

      {/* Stage controls */}
      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-gray-100">
        <button
          disabled={!canGoBack}
          onClick={(e) => {
            e.stopPropagation()
            if (canGoBack) onStageChange(client.id, STAGES[currentIndex - 1].code)
          }}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title={canGoBack ? `Vers ${STAGES[currentIndex - 1].label}` : ''}
        >
          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            title="Changer l'etape"
          >
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
              <div className="absolute right-0 bottom-full mb-1 z-20 bg-white rounded-lg shadow-lg border py-1 w-40">
                {STAGES.map((s) => (
                  <button
                    key={s.code}
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      if (s.code !== client.pipeline_stage) onStageChange(client.id, s.code)
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${
                      s.code === client.pipeline_stage ? 'font-semibold text-gray-900' : 'text-gray-600'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${s.header}`} />
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
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title={canGoForward ? `Vers ${STAGES[currentIndex + 1].label}` : ''}
        >
          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
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
    <div className="h-full flex flex-col -m-8">
      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b bg-white shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Pipeline</h1>
        <div className="flex items-center gap-3">
          {/* Commercial filter */}
          <select
            value={filterCommercial}
            onChange={(e) => setFilterCommercial(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="">Tous les commerciaux</option>
            {commerciaux.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}</option>
            ))}
          </select>

          {/* Coller un message */}
          <button
            onClick={() => setShowColler(true)}
            className="flex items-center gap-1.5 border border-gray-300 text-gray-700 px-3.5 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Coller un message
          </button>

          {/* Nouveau lead */}
          <button
            onClick={() => setShowNewLead(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nouveau lead
          </button>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 text-sm">Chargement...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 p-6 min-w-max h-full">
            {STAGES.map((stage) => {
              const stageClients = byStage[stage.code] || []
              return (
                <div key={stage.code} className={`w-72 flex flex-col rounded-xl ${stage.bg} shrink-0`}>
                  {/* Column header */}
                  <div className={`${stage.header} text-white px-4 py-2.5 rounded-t-xl flex items-center justify-between`}>
                    <span className="text-sm font-semibold">{stage.label}</span>
                    <span className="bg-white/25 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center">
                      {stageClients.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                    {stageClients.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-8">Aucun client</p>
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
