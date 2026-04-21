'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Commercial {
  id: string
  nom: string
  couleur: string
  actif?: boolean
}

interface TacheClient {
  id: string
  nom: string
  telephone: string | null
}

interface TacheAffaire {
  id: string
  titre: string
}

interface PJ {
  name: string
  url: string
  size: number
  type: string
  uploaded_at: string
}

interface Tache {
  id: string
  titre: string
  note: string | null
  commercial_id: string
  client_id: string | null
  affaire_id: string | null
  rappel_at: string | null
  rappel_sent: boolean
  fait: boolean
  fait_at: string | null
  pieces_jointes: PJ[]
  created_at: string
  updated_at: string
  clients: TacheClient | null
  commerciaux: Commercial | null
  affaires: TacheAffaire | null
}

interface ClientOption {
  id: string
  nom: string
  telephone: string | null
  email: string | null
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function IconPlus({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function IconCheck({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
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

function IconPaperclip({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
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

function IconTrash({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function IconUser({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function IconEye({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl mx-4 max-h-[90vh] overflow-y-auto ${wide ? 'w-full max-w-2xl' : 'w-full max-w-lg'}`}>
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
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}j`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function isOverdue(rappelAt: string | null): boolean {
  if (!rappelAt) return false
  return new Date(rappelAt) < new Date()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

// ---------------------------------------------------------------------------
// Task Card
// ---------------------------------------------------------------------------

function TacheCard({ tache, onDone, onDelete, onOpen }: {
  tache: Tache
  onDone: (id: string) => void
  onDelete: (id: string) => void
  onOpen: (tache: Tache) => void
}) {
  const overdue = isOverdue(tache.rappel_at)
  const hasPJ = tache.pieces_jointes && tache.pieces_jointes.length > 0

  return (
    <div
      className="kanban-card rounded-lg border p-3 cursor-pointer transition-all duration-150 relative group hover:shadow-md"
      onClick={() => onOpen(tache)}
    >
      {/* Title */}
      <p className="text-sm font-medium kanban-link pr-6 mb-1">{tache.titre}</p>

      {/* Note preview */}
      {tache.note && (
        <p className="text-[11px] kanban-text truncate mb-1.5" style={{ opacity: 0.6 }}>{tache.note}</p>
      )}

      {/* Tags row */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {tache.clients && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
            <IconUser className="w-2.5 h-2.5" />
            {tache.clients.nom}
          </span>
        )}
        {tache.affaires && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-100">
            {tache.affaires.titre}
          </span>
        )}
        {tache.rappel_at && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${overdue ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
            <IconBell className="w-2.5 h-2.5" />
            {formatDate(tache.rappel_at)}
          </span>
        )}
        {hasPJ && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200">
            <IconPaperclip className="w-2.5 h-2.5" />
            {tache.pieces_jointes.length}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] kanban-text" style={{ opacity: 0.4 }}>{timeAgo(tache.created_at)}</span>
      </div>

      {/* Hover actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <button
          onClick={e => { e.stopPropagation(); onDone(tache.id) }}
          className="p-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 transition-colors"
          title="Marquer comme fait"
          style={{ color: '#10B981' }}
        >
          <IconCheck className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); if (confirm('Supprimer cette tâche ?')) onDelete(tache.id) }}
          className="p-1.5 rounded-md bg-red-50 hover:bg-red-100 transition-colors"
          title="Supprimer"
          style={{ color: '#EF4444' }}
        >
          <IconTrash className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task Detail / Edit Panel
// ---------------------------------------------------------------------------

function TacheDetail({ tache, clients, onClose, onUpdate, onDelete }: {
  tache: Tache
  clients: ClientOption[]
  onClose: () => void
  onUpdate: () => void
  onDelete: (id: string) => void
}) {
  const [titre, setTitre] = useState(tache.titre)
  const [note, setNote] = useState(tache.note || '')
  const [clientId, setClientId] = useState(tache.client_id || '')
  const [rappelAt, setRappelAt] = useState(tache.rappel_at ? tache.rappel_at.slice(0, 16) : '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pjs, setPjs] = useState<PJ[]>(tache.pieces_jointes || [])
  const fileRef = useRef<HTMLInputElement>(null)

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow bg-white'

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/taches/${tache.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titre,
          note: note || null,
          client_id: clientId || null,
          rappel_at: rappelAt ? new Date(rappelAt).toISOString() : null,
        }),
      })
      onUpdate()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('tache_id', tache.id)
      const res = await fetch('/api/taches/upload', { method: 'POST', body: fd })
      if (res.ok) {
        const pj = await res.json()
        setPjs(prev => [...prev, pj])
      }
    } catch { /* ignore */ }
    finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDone() {
    await fetch(`/api/taches/${tache.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fait: true }),
    })
    onUpdate()
  }

  return (
    <div className="space-y-5">
      {/* Titre */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Titre</label>
        <input type="text" value={titre} onChange={e => setTitre(e.target.value)} className={inputClass} />
      </div>

      {/* Note */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Note</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} className={inputClass} placeholder="Ajouter une note..." />
      </div>

      {/* Client */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Client lié</label>
        <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputClass}>
          <option value="">-- Aucun --</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.nom}{c.telephone ? ` (${c.telephone})` : ''}</option>)}
        </select>
      </div>

      {/* Rappel */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Rappel</label>
        <input type="datetime-local" value={rappelAt} onChange={e => setRappelAt(e.target.value)} className={inputClass} />
      </div>

      {/* Pièces jointes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Pièces jointes ({pjs.length})
        </label>
        {pjs.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {pjs.map((pj, i) => (
              <a
                key={i}
                href={pj.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 bg-blue-50 rounded-lg px-3 py-2 border border-blue-100 transition-colors"
              >
                <IconPaperclip className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1">{pj.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{formatFileSize(pj.size)}</span>
              </a>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" onChange={handleUpload} className="hidden" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-600 font-medium py-2 px-3 border border-dashed border-gray-300 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
        >
          <IconPaperclip className="w-3.5 h-3.5" />
          {uploading ? 'Upload en cours...' : 'Ajouter un fichier'}
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        <button onClick={handleDone}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg font-medium text-sm bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors">
          <IconCheck className="w-4 h-4" />
          Fait
        </button>
        <button onClick={() => { if (confirm('Supprimer ?')) { onDelete(tache.id); onClose() } }}
          className="px-3 py-2.5 rounded-lg text-sm text-red-600 hover:bg-red-50 border border-red-200 transition-colors">
          <IconTrash className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New Task Quick Form (in column header)
// ---------------------------------------------------------------------------

function QuickAddForm({ commercialId, onSave, onCancel }: {
  commercialId: string
  onSave: () => void
  onCancel: () => void
}) {
  const [titre, setTitre] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titre.trim()) return
    setSaving(true)
    try {
      await fetch('/api/taches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre: titre.trim(), commercial_id: commercialId }),
      })
      onSave()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="p-2">
      <input
        type="text"
        value={titre}
        onChange={e => setTitre(e.target.value)}
        placeholder="Nouvelle tâche..."
        autoFocus
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
      />
      <div className="flex gap-1.5 mt-2">
        <button type="submit" disabled={saving || !titre.trim()}
          className="flex-1 bg-blue-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          Ajouter
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100 border border-gray-200 transition-colors">
          Annuler
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TachesPage() {
  const [taches, setTaches] = useState<Tache[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [allClients, setAllClients] = useState<ClientOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null) // commercial_id
  const [selectedTache, setSelectedTache] = useState<Tache | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [tRes, cRes, clRes] = await Promise.all([
        fetch(`/api/taches?done=${showDone}`),
        fetch('/api/commerciaux'),
        fetch('/api/clients'),
      ])
      if (tRes.ok) setTaches(await tRes.json())
      if (cRes.ok) setCommerciaux(await cRes.json())
      if (clRes.ok) setAllClients(await clRes.json())
    } catch (err) {
      console.error('Erreur chargement tâches:', err)
    } finally {
      setLoading(false)
    }
  }, [showDone])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleDone(id: string) {
    setTaches(prev => prev.filter(t => t.id !== id))
    try {
      await fetch(`/api/taches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fait: true }),
      })
    } catch { /* ignore */ }
    fetchData()
  }

  async function handleDelete(id: string) {
    setTaches(prev => prev.filter(t => t.id !== id))
    try {
      await fetch(`/api/taches/${id}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    fetchData()
  }

  function handleTaskSaved() {
    setAddingTo(null)
    setSelectedTache(null)
    fetchData()
  }

  // Group tasks by commercial
  const byCommercial: Record<string, Tache[]> = {}
  for (const c of commerciaux) byCommercial[c.id] = []
  for (const t of taches) {
    if (byCommercial[t.commercial_id]) {
      byCommercial[t.commercial_id].push(t)
    }
  }

  return (
    <div className="h-full flex flex-col -m-8 bg-gray-50/50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Tâches</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDone}
              onChange={e => setShowDone(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Afficher terminées
          </label>
        </div>
      </div>

      {/* Columns */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Chargement...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-3 p-6 pt-4 min-w-max h-full">
            {commerciaux.filter(c => c.actif !== false).map(commercial => {
              const tasks = byCommercial[commercial.id] || []
              const overdueCount = tasks.filter(t => isOverdue(t.rappel_at)).length
              return (
                <div key={commercial.id} className="kanban-column w-80 flex flex-col shrink-0 rounded-md border">
                  {/* Column header */}
                  <div className="kanban-column-header px-3 py-2.5 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: commercial.couleur }} />
                        <span className="text-[13px] font-semibold kanban-text">{commercial.nom}</span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded kanban-count">
                          {tasks.length}
                        </span>
                        {overdueCount > 0 && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                            {overdueCount} en retard
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setAddingTo(addingTo === commercial.id ? null : commercial.id)}
                        className="p-1 rounded hover:bg-blue-50 transition-colors"
                        style={{ color: '#3B82F6' }}
                        title="Ajouter une tâche"
                      >
                        <IconPlus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Quick add form */}
                  {addingTo === commercial.id && (
                    <QuickAddForm
                      commercialId={commercial.id}
                      onSave={handleTaskSaved}
                      onCancel={() => setAddingTo(null)}
                    />
                  )}

                  {/* Tasks */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {tasks.length === 0 && addingTo !== commercial.id ? (
                      <p className="text-center text-[11px] py-8 kanban-empty">Aucune tâche</p>
                    ) : (
                      tasks.map(t => (
                        <TacheCard
                          key={t.id}
                          tache={t}
                          onDone={handleDone}
                          onDelete={handleDelete}
                          onOpen={setSelectedTache}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!selectedTache} onClose={() => setSelectedTache(null)} title="Détail de la tâche" wide>
        {selectedTache && (
          <TacheDetail
            tache={selectedTache}
            clients={allClients}
            onClose={() => setSelectedTache(null)}
            onUpdate={handleTaskSaved}
            onDelete={handleDelete}
          />
        )}
      </Modal>
    </div>
  )
}
