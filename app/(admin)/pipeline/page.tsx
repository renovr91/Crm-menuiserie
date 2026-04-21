'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGES = [
  { code: 'nouveau', label: 'Nouveau', color: '#3B82F6' },
  { code: 'contacte', label: 'Contacté', color: '#EAB308' },
  { code: 'visite', label: 'Visite', color: '#6366F1' },
  { code: 'devis_envoye', label: 'Devis envoyé', color: '#F97316' },
  { code: 'signe', label: 'Signé', color: '#22C55E' },
  { code: 'commande', label: 'Commandé', color: '#A855F7' },
  { code: 'livre', label: 'Livré', color: '#8B5CF6' },
  { code: 'pose', label: 'Posé', color: '#14B8A6' },
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
  { value: 'telephone', label: 'Téléphone' },
  { value: 'email', label: 'Email' },
  { value: 'bouche a oreille', label: 'Bouche à oreille' },
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

interface Client {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  source: string | null
  adresse: string | null
  ville: string | null
  code_postal: string | null
}

interface Affaire {
  id: string
  client_id: string
  titre: string
  description: string | null
  pipeline_stage: string
  montant_estime: number | null
  commercial_id: string | null
  created_at: string
  updated_at: string
  clients: Client | null
  commerciaux: { nom: string; couleur: string } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEUR(val: number): string {
  return Number(val).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
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

function IconSearch({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Modal wrapper
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
// Nouvelle Affaire form
// ---------------------------------------------------------------------------

function NouvelleAffaireForm({
  commerciaux,
  onSave,
}: {
  commerciaux: Commercial[]
  onSave: () => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [allClients, setAllClients] = useState<Client[]>([])
  const [loadingClients, setLoadingClients] = useState(true)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [showNewClientForm, setShowNewClientForm] = useState(false)

  // Affaire fields
  const [titre, setTitre] = useState('')
  const [description, setDescription] = useState('')
  const [montant, setMontant] = useState('')
  const [commercialId, setCommercialId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // New client fields
  const [newNom, setNewNom] = useState('')
  const [newTel, setNewTel] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newSource, setNewSource] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)

  useEffect(() => {
    fetch('/api/clients')
      .then(res => res.ok ? res.json() : [])
      .then(data => setAllClients(data))
      .catch(() => {})
      .finally(() => setLoadingClients(false))
  }, [])

  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return allClients.slice(0, 10)
    const q = searchQuery.toLowerCase()
    return allClients.filter(c =>
      c.nom.toLowerCase().includes(q) ||
      (c.telephone && c.telephone.includes(q)) ||
      (c.email && c.email.toLowerCase().includes(q))
    ).slice(0, 10)
  }, [allClients, searchQuery])

  async function handleCreateClient() {
    if (!newNom.trim()) return
    setCreatingClient(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: newNom.trim(),
          telephone: newTel.trim() || null,
          email: newEmail.trim() || null,
          source: newSource || null,
          pipeline_stage: 'nouveau',
        }),
      })
      if (!res.ok) throw new Error('Erreur création client')
      const newClient = await res.json()
      setAllClients(prev => [newClient, ...prev])
      setSelectedClient(newClient)
      setShowNewClientForm(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreatingClient(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedClient) { setError('Sélectionnez un client'); return }
    if (!titre.trim()) { setError('Le titre est requis'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/affaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selectedClient.id,
          titre: titre.trim(),
          description: description.trim() || null,
          montant_estime: montant ? parseFloat(montant) : 0,
          commercial_id: commercialId || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erreur création affaire')
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
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Step 1: Select client */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">1. Client</label>
        {selectedClient ? (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <div>
              <p className="font-medium text-blue-900">{selectedClient.nom}</p>
              <p className="text-xs text-blue-600">
                {[selectedClient.telephone, selectedClient.email].filter(Boolean).join(' · ') || 'Pas de contact'}
              </p>
            </div>
            <button type="button" onClick={() => setSelectedClient(null)} className="text-blue-400 hover:text-blue-600 text-sm">
              Changer
            </button>
          </div>
        ) : showNewClientForm ? (
          <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-600">Nouveau client</p>
            <input type="text" value={newNom} onChange={e => setNewNom(e.target.value)} placeholder="Nom *" className={inputClass} />
            <div className="grid grid-cols-2 gap-3">
              <input type="tel" value={newTel} onChange={e => setNewTel(e.target.value)} placeholder="Téléphone" className={inputClass} />
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" className={inputClass} />
            </div>
            <select value={newSource} onChange={e => setNewSource(e.target.value)} className={inputClass}>
              <option value="">-- Source --</option>
              {SOURCE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="button" onClick={handleCreateClient} disabled={creatingClient || !newNom.trim()}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {creatingClient ? 'Création...' : 'Créer le client'}
              </button>
              <button type="button" onClick={() => setShowNewClientForm(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 border border-gray-200">
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Rechercher un client (nom, tél, email)..."
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            {loadingClients ? (
              <p className="text-xs text-gray-400 py-2">Chargement...</p>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Aucun client trouvé</p>
                ) : (
                  filteredClients.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedClient(c)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">{c.nom}</p>
                        <p className="text-xs text-gray-500">{[c.telephone, c.email, c.ville].filter(Boolean).join(' · ')}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
            <button type="button" onClick={() => setShowNewClientForm(true)}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium py-2 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors">
              <IconPlus className="w-3.5 h-3.5" />
              Créer un nouveau client
            </button>
          </div>
        )}
      </div>

      {/* Step 2: Affaire details */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">2. Détails de l&apos;affaire</label>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Titre de l&apos;affaire *</label>
            <input type="text" value={titre} onChange={e => setTitre(e.target.value)} required className={inputClass}
              placeholder="Ex: Fenêtres PVC salon + chambre" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description du besoin</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={inputClass}
              placeholder="Détails du projet, dimensions, contraintes..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Montant estimé (€)</label>
              <input type="number" value={montant} onChange={e => setMontant(e.target.value)} className={inputClass}
                placeholder="0" min="0" step="0.01" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Commercial</label>
              <select value={commercialId} onChange={e => setCommercialId(e.target.value)} className={inputClass}>
                <option value="">-- Aucun --</option>
                {commerciaux.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={saving || !selectedClient || !titre.trim()}
        className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
      >
        {saving ? 'Création...' : 'Créer l\'affaire'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Edit Affaire form
// ---------------------------------------------------------------------------

function EditAffaireForm({ affaire, commerciaux, onSave }: {
  affaire: Affaire
  commerciaux: Commercial[]
  onSave: () => void
}) {
  const [titre, setTitre] = useState(affaire.titre)
  const [description, setDescription] = useState(affaire.description || '')
  const [montant, setMontant] = useState(affaire.montant_estime ? String(affaire.montant_estime) : '')
  const [commercialId, setCommercialId] = useState(affaire.commercial_id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow bg-white'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titre.trim()) { setError('Le titre est requis'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/affaires/${affaire.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titre: titre.trim(),
          description: description.trim() || null,
          montant_estime: montant ? parseFloat(montant) : 0,
          commercial_id: commercialId || null,
        }),
      })
      if (!res.ok) throw new Error('Erreur mise à jour')
      onSave()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
        <p className="text-xs text-gray-500">Client</p>
        <p className="text-sm font-medium text-gray-900">{affaire.clients?.nom || 'Inconnu'}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Titre *</label>
        <input type="text" value={titre} onChange={e => setTitre(e.target.value)} required className={inputClass} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Montant estimé (€)</label>
          <input type="number" value={montant} onChange={e => setMontant(e.target.value)} className={inputClass} min="0" step="0.01" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Commercial</label>
          <select value={commercialId} onChange={e => setCommercialId(e.target.value)} className={inputClass}>
            <option value="">-- Aucun --</option>
            {commerciaux.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={saving}
        className="w-full py-2.5 rounded-lg text-white font-medium text-sm bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50">
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Pipeline card — now shows an Affaire
// ---------------------------------------------------------------------------

function PipelineCard({ affaire, onStageChange, onEdit, onDelete }: {
  affaire: Affaire
  onStageChange: (id: string, newStage: string) => void
  onEdit: (affaire: Affaire) => void
  onDelete: (id: string) => void
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const currentIndex = STAGES.findIndex(s => s.code === affaire.pipeline_stage)
  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < STAGES.length - 1

  const clientName = affaire.clients?.nom || 'Client inconnu'
  const initials = clientName
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const createdDate = new Date(affaire.created_at).toLocaleDateString('fr-FR')

  return (
    <div
      className="kanban-card rounded-md border cursor-pointer transition-all duration-150 relative group"
      onClick={() => affaire.clients && router.push(`/clients/${affaire.clients.id}`)}
    >
      <div className="px-3 pt-3 pb-2">
        {/* Ligne 1 — Titre de l'affaire */}
        <p className="text-sm font-semibold truncate pr-5 mb-0.5 kanban-link">
          {affaire.titre}
        </p>

        {/* Ligne 2 — Nom du client */}
        <p className="text-[12px] truncate mb-1 kanban-text" style={{ opacity: 0.7 }}>
          {clientName}
        </p>

        {/* Ligne 3 — Description */}
        {affaire.description && (
          <p className="text-[11px] truncate mb-1.5 kanban-text" style={{ opacity: 0.5 }}>
            {affaire.description}
          </p>
        )}

        {/* Info lines */}
        <div className="space-y-0.5 text-[12px] kanban-text">
          {affaire.montant_estime != null && affaire.montant_estime > 0 && (
            <div><span className="kanban-label">Montant : </span>{formatEUR(affaire.montant_estime)}</div>
          )}
          <div><span className="kanban-label">Créé le : </span>{createdDate}</div>
          {affaire.commerciaux && (
            <div><span className="kanban-label">Commercial : </span>{affaire.commerciaux.nom}</div>
          )}
        </div>
      </div>

      {/* Bottom section */}
      <div className="kanban-card-footer px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 kanban-avatar"
            style={affaire.commerciaux?.couleur ? {
              background: `${affaire.commerciaux.couleur}25`,
              color: affaire.commerciaux.couleur,
            } : undefined}
          >
            {initials || '–'}
          </span>
          <span className="text-[12px] truncate kanban-text">{clientName}</span>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
        <button
          onClick={e => { e.stopPropagation(); onEdit(affaire) }}
          className="p-1 rounded hover:bg-blue-50 transition-colors"
          title="Modifier"
          style={{ color: '#3B82F6' }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={e => { e.stopPropagation(); if (confirm(`Supprimer l'affaire "${affaire.titre}" ?`)) onDelete(affaire.id) }}
          className="p-1 rounded hover:bg-red-50 transition-colors"
          title="Supprimer"
          style={{ color: '#EF4444' }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <div className="w-px h-3 bg-gray-200 mx-0.5" />
        <button
          disabled={!canGoBack}
          onClick={e => {
            e.stopPropagation()
            if (canGoBack) onStageChange(affaire.id, STAGES[currentIndex - 1].code)
          }}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title={canGoBack ? `Vers ${STAGES[currentIndex - 1].label}` : ''}
          style={{ color: '#516F90' }}
        >
          <IconChevronLeft className="w-3 h-3" />
        </button>
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            title="Changer l'étape"
            style={{ color: '#516F90' }}
          >
            <IconChevronDown className="w-3 h-3" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setMenuOpen(false) }} />
              <div className="kanban-dropdown absolute right-0 bottom-full mb-1 z-20 rounded-md shadow-lg border py-1.5 w-44">
                {STAGES.map(s => (
                  <button
                    key={s.code}
                    onClick={e => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      if (s.code !== affaire.pipeline_stage) onStageChange(affaire.id, s.code)
                    }}
                    className={`kanban-dropdown-item w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${s.code === affaire.pipeline_stage ? 'active' : ''}`}
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
          onClick={e => {
            e.stopPropagation()
            if (canGoForward) onStageChange(affaire.id, STAGES[currentIndex + 1].code)
          }}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title={canGoForward ? `Vers ${STAGES[currentIndex + 1].label}` : ''}
          style={{ color: '#516F90' }}
        >
          <IconChevronRight className="w-3 h-3" />
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
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: accentColor }} />
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {secondary && <div className="text-sm text-gray-500 mt-0.5">{secondary}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function StatsBar({ affaires, commerciaux }: { affaires: Affaire[]; commerciaux: Commercial[] }) {
  const stats = useMemo(() => {
    const totalAffaires = affaires.length
    const totalMontant = affaires.reduce((sum, a) => sum + (Number(a.montant_estime) || 0), 0)
    const devisEnvoye = affaires.filter(a => a.pipeline_stage === 'devis_envoye')
    const montantDevis = devisEnvoye.reduce((sum, a) => sum + (Number(a.montant_estime) || 0), 0)
    const signes = affaires.filter(a => a.pipeline_stage === 'signe' || a.pipeline_stage === 'commande' || a.pipeline_stage === 'livre' || a.pipeline_stage === 'pose')
    const montantSignes = signes.reduce((sum, a) => sum + (Number(a.montant_estime) || 0), 0)
    const nouveaux = affaires.filter(a => a.pipeline_stage === 'nouveau').length

    return { totalAffaires, totalMontant, devisEnvoye: devisEnvoye.length, montantDevis, montantSignes, signes: signes.length, nouveaux }
  }, [affaires])

  return (
    <div className="px-6 pt-5 pb-2 shrink-0 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Affaires actives"
          value={<span className="text-blue-600">{stats.totalAffaires}</span>}
          secondary={stats.totalMontant > 0 ? formatEUR(stats.totalMontant) : undefined}
          accentColor="#3B82F6"
          icon={<IconUsers className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="Signées"
          value={<span className="text-emerald-600">{stats.signes}</span>}
          secondary={stats.montantSignes > 0 ? formatEUR(stats.montantSignes) : undefined}
          accentColor="#10B981"
          icon={<IconTrendUp className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="Devis en attente"
          value={
            <span className="text-amber-600">
              {stats.devisEnvoye}
              <span className="text-base font-normal text-gray-400 ml-1">devis</span>
            </span>
          }
          secondary={stats.montantDevis > 0 ? formatEUR(stats.montantDevis) : undefined}
          accentColor="#F59E0B"
          icon={<IconClock className="w-3.5 h-3.5" />}
        />
        <StatCard
          label="Nouveaux"
          value={<span className="text-violet-600">{stats.nouveaux}</span>}
          accentColor="#8B5CF6"
          icon={<IconStar className="w-3.5 h-3.5" />}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const [affaires, setAffaires] = useState<Affaire[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [filterCommercial, setFilterCommercial] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNewAffaire, setShowNewAffaire] = useState(false)
  const [editingAffaire, setEditingAffaire] = useState<Affaire | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const url = filterCommercial ? `/api/affaires?commercial_id=${filterCommercial}` : '/api/affaires'
      const [affairesRes, commerciauxRes] = await Promise.all([
        fetch(url),
        fetch('/api/commerciaux'),
      ])
      if (affairesRes.ok) setAffaires(await affairesRes.json())
      if (commerciauxRes.ok) setCommerciaux(await commerciauxRes.json())
    } catch (err) {
      console.error('Erreur chargement pipeline:', err)
    } finally {
      setLoading(false)
    }
  }, [filterCommercial])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleStageChange(affaireId: string, newStage: string) {
    setAffaires(prev =>
      prev.map(a => a.id === affaireId ? { ...a, pipeline_stage: newStage } : a)
    )
    try {
      const res = await fetch(`/api/affaires/${affaireId}`, {
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

  function handleSaved() {
    setShowNewAffaire(false)
    setEditingAffaire(null)
    fetchData()
  }

  async function handleDelete(affaireId: string) {
    setAffaires(prev => prev.filter(a => a.id !== affaireId))
    try {
      await fetch(`/api/affaires?id=${affaireId}`, { method: 'DELETE' })
    } catch { /* ignore */ }
    fetchData()
  }

  // Group affaires by stage
  const byStage: Record<string, Affaire[]> = {}
  for (const stage of STAGES) byStage[stage.code] = []
  for (const affaire of affaires) {
    if (byStage[affaire.pipeline_stage]) {
      byStage[affaire.pipeline_stage].push(affaire)
    }
  }

  return (
    <div className="h-full flex flex-col -m-8 bg-gray-50/50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Pipeline</h1>
        <div className="flex items-center gap-2.5">
          <select
            value={filterCommercial}
            onChange={e => setFilterCommercial(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-gray-700 transition-shadow"
          >
            <option value="">Tous les commerciaux</option>
            {commerciaux.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>

          <button
            onClick={() => setShowNewAffaire(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
          >
            <IconPlus className="w-4 h-4" />
            Nouvelle affaire
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && <StatsBar affaires={affaires} commerciaux={commerciaux} />}

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
            {STAGES.map(stage => {
              const stageAffaires = byStage[stage.code] || []
              const stageTotal = stageAffaires.reduce((sum, a) => sum + (Number(a.montant_estime) || 0), 0)
              return (
                <div key={stage.code} className="kanban-column w-80 flex flex-col shrink-0 rounded-md border">
                  {/* Column header */}
                  <div className="kanban-column-header px-3 py-2.5 border-b">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold kanban-text">{stage.label}</span>
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded kanban-count">
                        {stageAffaires.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards container */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageAffaires.length === 0 ? (
                      <p className="text-center text-[11px] py-8 kanban-empty">Aucune affaire</p>
                    ) : (
                      stageAffaires.map(affaire => (
                        <PipelineCard
                          key={affaire.id}
                          affaire={affaire}
                          onStageChange={handleStageChange}
                          onEdit={setEditingAffaire}
                          onDelete={handleDelete}
                        />
                      ))
                    )}
                  </div>

                  {/* Column footer */}
                  {stageTotal > 0 && (
                    <div className="kanban-column-footer px-3 py-2 border-t text-[12px] kanban-text">
                      <span className="kanban-label">Montant total : </span>
                      <span className="font-semibold">{formatEUR(stageTotal)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal open={showNewAffaire} onClose={() => setShowNewAffaire(false)} title="Nouvelle affaire" wide>
        <NouvelleAffaireForm commerciaux={commerciaux} onSave={handleSaved} />
      </Modal>

      <Modal open={!!editingAffaire} onClose={() => setEditingAffaire(null)} title="Modifier l'affaire">
        {editingAffaire && (
          <EditAffaireForm
            affaire={editingAffaire}
            commerciaux={commerciaux}
            onSave={handleSaved}
          />
        )}
      </Modal>
    </div>
  )
}
