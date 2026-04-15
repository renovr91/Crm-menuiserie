'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = [
  { code: 'nouveau', label: 'Nouveau', color: 'bg-blue-100 text-blue-700' },
  { code: 'contacte', label: 'Contacte', color: 'bg-yellow-100 text-yellow-700' },
  { code: 'visite', label: 'Visite', color: 'bg-indigo-100 text-indigo-700' },
  { code: 'devis_envoye', label: 'Devis envoye', color: 'bg-orange-100 text-orange-700' },
  { code: 'signe', label: 'Signe', color: 'bg-green-100 text-green-700' },
  { code: 'commande', label: 'Commande', color: 'bg-purple-100 text-purple-700' },
  { code: 'livre', label: 'Livre', color: 'bg-violet-100 text-violet-700' },
  { code: 'pose', label: 'Pose', color: 'bg-teal-100 text-teal-700' },
  { code: 'termine', label: 'Termine', color: 'bg-gray-100 text-gray-700' },
  { code: 'perdu', label: 'Perdu', color: 'bg-red-100 text-red-700' },
]

const DEVIS_STATUS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoye', color: 'bg-blue-100 text-blue-700' },
  lu: { label: 'Lu', color: 'bg-yellow-100 text-yellow-700' },
  signe: { label: 'Signe', color: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refuse', color: 'bg-red-100 text-red-700' },
  expire: { label: 'Expire', color: 'bg-gray-100 text-gray-500' },
}

const COMMANDE_STATUS: Record<string, { label: string; color: string }> = {
  en_attente: { label: 'En attente', color: 'bg-gray-100 text-gray-700' },
  commandee: { label: 'Commandee', color: 'bg-blue-100 text-blue-700' },
  en_fabrication: { label: 'En fabrication', color: 'bg-amber-100 text-amber-700' },
  expediee: { label: 'Expediee', color: 'bg-purple-100 text-purple-700' },
  livree: { label: 'Livree', color: 'bg-green-100 text-green-700' },
}

const SAV_STATUS: Record<string, { label: string; color: string }> = {
  ouvert: { label: 'Ouvert', color: 'bg-red-100 text-red-700' },
  en_cours: { label: 'En cours', color: 'bg-yellow-100 text-yellow-700' },
  resolu: { label: 'Resolu', color: 'bg-green-100 text-green-700' },
  ferme: { label: 'Ferme', color: 'bg-gray-100 text-gray-700' },
}

const SAV_PRIORITE: Record<string, { label: string; color: string }> = {
  basse: { label: 'Basse', color: 'bg-gray-100 text-gray-600' },
  moyenne: { label: 'Moyenne', color: 'bg-yellow-100 text-yellow-700' },
  haute: { label: 'Haute', color: 'bg-orange-100 text-orange-700' },
  urgente: { label: 'Urgente', color: 'bg-red-100 text-red-700' },
}

const ACTIVITY_ICONS: Record<string, string> = {
  appel: '\u{1F4DE}',
  note: '\u{1F4DD}',
  rappel: '\u23F0',
  email: '\u2709\uFE0F',
  visite: '\u{1F3E0}',
  relance: '\u{1F504}',
}

const SOURCE_OPTIONS = [
  { value: 'leboncoin', label: 'LeBonCoin' },
  { value: 'telephone', label: 'Telephone' },
  { value: 'email', label: 'Email' },
  { value: 'bouche a oreille', label: 'Bouche a oreille' },
  { value: 'site_web', label: 'Site web' },
  { value: 'autre', label: 'Autre' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientData {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
  notes: string | null
  pipeline_stage: string | null
  commercial_id: string | null
  source: string | null
  besoin: string | null
  montant_estime: number | null
  priorite: string | null
  created_at: string
  portal_token: string | null
  devis: DevisItem[]
}

interface DevisItem {
  id: string
  reference: string
  status: string
  montant_ht: number
  montant_ttc: number
  created_at: string
}

interface Activite {
  id: string
  client_id: string
  commercial_id: string | null
  type: string
  contenu: string | null
  date_prevue: string | null
  fait: boolean
  date_faite: string | null
  created_at: string
  commerciaux: { nom: string } | null
}

interface Commande {
  id: string
  client_id: string
  fournisseur: string
  designation: string | null
  date_commande: string | null
  date_livraison_prevue: string | null
  delai_prevu: string | null
  status: string
  notes: string | null
}

interface SavTicket {
  id: string
  client_id: string
  commercial_id: string | null
  sujet: string
  description: string | null
  priorite: string
  status: string
  created_at: string
  commerciaux: { nom: string } | null
}

interface Commercial {
  id: string
  nom: string
  couleur: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEUR(val: number | null | undefined): string {
  if (val == null) return '0,00 \u20AC'
  return Number(val).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-FR')
}

function relativeDate(d: string): string {
  const now = new Date()
  const date = new Date(d)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "A l'instant"
  if (diffMins < 60) return `Il y a ${diffMins}min`
  if (diffHours < 24) return `Il y a ${diffHours}h`
  if (diffDays < 7) return `Il y a ${diffDays}j`
  return formatDate(d)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientDetailPage() {
  const { id } = useParams()
  const router = useRouter()

  // --- State ---
  const [client, setClient] = useState<ClientData | null>(null)
  const [activites, setActivites] = useState<Activite[]>([])
  const [commandes, setCommandes] = useState<Commande[]>([])
  const [savTickets, setSavTickets] = useState<SavTicket[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'activites' | 'devis' | 'commandes' | 'sav'>('activites')
  const [deleting, setDeleting] = useState(false)

  // Inline forms
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [showRappelForm, setShowRappelForm] = useState(false)
  const [showCommandeForm, setShowCommandeForm] = useState(false)
  const [showSavForm, setShowSavForm] = useState(false)

  // Editable client fields
  const [editClient, setEditClient] = useState({
    nom: '', telephone: '', email: '', adresse: '', code_postal: '', ville: '',
  })
  const [editBesoin, setEditBesoin] = useState('')
  const [editMontant, setEditMontant] = useState('')

  // Form data
  const [noteContenu, setNoteContenu] = useState('')
  const [rappelContenu, setRappelContenu] = useState('')
  const [rappelDate, setRappelDate] = useState('')
  const [cmdForm, setCmdForm] = useState({ fournisseur: '', designation: '', date_commande: '', delai_prevu: '', date_livraison_prevue: '' })
  const [savForm, setSavForm] = useState({ sujet: '', description: '', priorite: 'moyenne', commercial_id: '' })

  // --- Data fetching ---
  const loadData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [clientRes, activitesRes, commandesRes, savRes, commerciauxRes] = await Promise.all([
        fetch(`/api/clients/${id}`),
        fetch(`/api/activites?client_id=${id}`),
        fetch(`/api/commandes?client_id=${id}`),
        fetch(`/api/sav?client_id=${id}`),
        fetch('/api/commerciaux'),
      ])

      if (clientRes.ok) {
        const c = await clientRes.json()
        setClient(c)
        setEditClient({
          nom: c.nom || '', telephone: c.telephone || '', email: c.email || '',
          adresse: c.adresse || '', code_postal: c.code_postal || '', ville: c.ville || '',
        })
        setEditBesoin(c.besoin || '')
        setEditMontant(c.montant_estime ? String(c.montant_estime) : '')
      }
      if (activitesRes.ok) setActivites(await activitesRes.json())
      if (commandesRes.ok) setCommandes(await commandesRes.json())
      if (savRes.ok) setSavTickets(await savRes.json())
      if (commerciauxRes.ok) setCommerciaux(await commerciauxRes.json())
    } catch (err) { console.error('Load error:', err) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  // --- PATCH helper ---
  const patchClient = async (fields: Record<string, unknown>) => {
    if (!client) return
    const res = await fetch(`/api/clients/${client.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const updated = await res.json()
      setClient((prev) => prev ? { ...prev, ...updated } : prev)
    }
  }

  // --- Actions ---
  const handleSaveContact = async () => {
    await patchClient(editClient)
  }

  const handleStageChange = async (stage: string) => {
    await patchClient({ pipeline_stage: stage })
  }

  const handleCommercialChange = async (commercialId: string) => {
    await patchClient({ commercial_id: commercialId || null })
  }

  const handleSourceChange = async (source: string) => {
    await patchClient({ source: source || null })
  }

  const handleBesoinBlur = async () => {
    if (editBesoin !== (client?.besoin || '')) {
      await patchClient({ besoin: editBesoin })
    }
  }

  const handleMontantBlur = async () => {
    const val = editMontant ? parseFloat(editMontant) : null
    if (val !== client?.montant_estime) {
      await patchClient({ montant_estime: val })
    }
  }

  const handleAddNote = async () => {
    if (!noteContenu.trim() || !client) return
    const res = await fetch('/api/activites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, type: 'note', contenu: noteContenu }),
    })
    if (res.ok) {
      setNoteContenu('')
      setShowNoteForm(false)
      const updated = await fetch(`/api/activites?client_id=${id}`)
      if (updated.ok) setActivites(await updated.json())
    }
  }

  const handleAddRappel = async () => {
    if (!rappelContenu.trim() || !rappelDate || !client) return
    const res = await fetch('/api/activites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, type: 'rappel', contenu: rappelContenu, date_prevue: rappelDate }),
    })
    if (res.ok) {
      setRappelContenu('')
      setRappelDate('')
      setShowRappelForm(false)
      const updated = await fetch(`/api/activites?client_id=${id}`)
      if (updated.ok) setActivites(await updated.json())
    }
  }

  const handleMarkDone = async (activiteId: string) => {
    const res = await fetch(`/api/activites/${activiteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fait: true, date_faite: new Date().toISOString() }),
    })
    if (res.ok) {
      const updated = await fetch(`/api/activites?client_id=${id}`)
      if (updated.ok) setActivites(await updated.json())
    }
  }

  const handleAddCommande = async () => {
    if (!cmdForm.fournisseur || !client) return
    const res = await fetch('/api/commandes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, ...cmdForm }),
    })
    if (res.ok) {
      setCmdForm({ fournisseur: '', designation: '', date_commande: '', delai_prevu: '', date_livraison_prevue: '' })
      setShowCommandeForm(false)
      const updated = await fetch(`/api/commandes?client_id=${id}`)
      if (updated.ok) setCommandes(await updated.json())
    }
  }

  const handleAddSav = async () => {
    if (!savForm.sujet || !client) return
    const res = await fetch('/api/sav', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, ...savForm, commercial_id: savForm.commercial_id || null }),
    })
    if (res.ok) {
      setSavForm({ sujet: '', description: '', priorite: 'moyenne', commercial_id: '' })
      setShowSavForm(false)
      const updated = await fetch(`/api/sav?client_id=${id}`)
      if (updated.ok) setSavTickets(await updated.json())
    }
  }

  const handleDelete = async () => {
    if (!client || !confirm('Supprimer ce client et tous ses devis ? Cette action est irreversible.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Erreur suppression')
      router.push('/clients')
    } catch (err) { alert((err as Error).message) }
    finally { setDeleting(false) }
  }

  // --- Derived ---
  const devisArray = client?.devis || []
  const nextAction = activites
    .filter((a) => !a.fait && a.date_prevue && (a.type === 'rappel' || a.type === 'visite'))
    .sort((a, b) => new Date(a.date_prevue!).getTime() - new Date(b.date_prevue!).getTime())[0]

  const currentStage = PIPELINE_STAGES.find((s) => s.code === client?.pipeline_stage) || PIPELINE_STAGES[0]

  // --- Loading / Error ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-400">Chargement...</div>
      </div>
    )
  }
  if (!client) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-red-600">Client non trouve</div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-7xl mx-auto">
      {/* Breadcrumb + Header */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
        <Link href="/clients" className="hover:text-gray-700">Clients</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{client.nom}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold flex-1">{client.nom}</h1>
        <div className="flex items-center gap-3">
          {/* Pipeline stage dropdown */}
          <select
            value={client.pipeline_stage || 'nouveau'}
            onChange={(e) => handleStageChange(e.target.value)}
            className={`text-sm font-medium rounded-full px-3 py-1.5 border-0 cursor-pointer ${currentStage.color}`}
          >
            {PIPELINE_STAGES.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
          {client.priorite === 'haute' && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">Priorite haute</span>
          )}
          {client.priorite === 'urgente' && (
            <span className="text-xs bg-red-200 text-red-800 px-2 py-1 rounded-full font-medium">Urgent</span>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ============================================================= */}
        {/* LEFT COLUMN */}
        {/* ============================================================= */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['activites', 'devis', 'commandes', 'sav'] as const).map((tab) => {
              const labels: Record<string, string> = {
                activites: 'Activites',
                devis: `Devis (${devisArray.length})`,
                commandes: `Commandes (${commandes.length})`,
                sav: `SAV (${savTickets.length})`,
              }
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                    activeTab === tab
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {labels[tab]}
                </button>
              )
            })}
          </div>

          {/* ---- ACTIVITES TAB ---- */}
          {activeTab === 'activites' && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Activites</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowNoteForm(!showNoteForm); setShowRappelForm(false) }}
                    className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {'\u{1F4DD}'} Note
                  </button>
                  <button
                    onClick={() => { setShowRappelForm(!showRappelForm); setShowNoteForm(false) }}
                    className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {'\u23F0'} Rappel
                  </button>
                </div>
              </div>

              {/* Note form */}
              {showNoteForm && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
                  <textarea
                    value={noteContenu}
                    onChange={(e) => setNoteContenu(e.target.value)}
                    placeholder="Ajouter une note..."
                    rows={3}
                    className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowNoteForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Annuler</button>
                    <button onClick={handleAddNote} disabled={!noteContenu.trim()} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">Ajouter</button>
                  </div>
                </div>
              )}

              {/* Rappel form */}
              {showRappelForm && (
                <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <textarea
                    value={rappelContenu}
                    onChange={(e) => setRappelContenu(e.target.value)}
                    placeholder="Objet du rappel..."
                    rows={2}
                    className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <input
                    type="datetime-local"
                    value={rappelDate}
                    onChange={(e) => setRappelDate(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowRappelForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Annuler</button>
                    <button onClick={handleAddRappel} disabled={!rappelContenu.trim() || !rappelDate} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">Planifier</button>
                  </div>
                </div>
              )}

              {/* Timeline */}
              {activites.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">Aucune activite</p>
              ) : (
                <div className="space-y-3">
                  {activites.map((a) => {
                    const isPendingRappel = a.type === 'rappel' && !a.fait && a.date_prevue
                    return (
                      <div
                        key={a.id}
                        className={`flex gap-3 p-3 rounded-lg border transition-colors ${
                          isPendingRappel
                            ? 'bg-yellow-50 border-yellow-200'
                            : 'bg-white border-gray-100 hover:border-gray-200'
                        }`}
                      >
                        <span className="text-lg flex-shrink-0">{ACTIVITY_ICONS[a.type] || '\u{1F4DD}'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-gray-900">{a.contenu || '(pas de contenu)'}</p>
                            {isPendingRappel && (
                              <button
                                onClick={() => handleMarkDone(a.id)}
                                className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 flex-shrink-0"
                              >
                                Fait {'\u2713'}
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-400">{relativeDate(a.created_at)}</span>
                            {a.date_prevue && (
                              <span className={`text-xs ${isPendingRappel ? 'text-yellow-600 font-medium' : 'text-gray-400'}`}>
                                Prevu: {formatDate(a.date_prevue)}
                              </span>
                            )}
                            {a.commerciaux?.nom && (
                              <span className="text-xs text-gray-400">par {a.commerciaux.nom}</span>
                            )}
                            {a.fait && (
                              <span className="text-xs text-green-600">Fait</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---- DEVIS TAB ---- */}
          {activeTab === 'devis' && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Devis ({devisArray.length})</h2>
                <Link
                  href={`/devis/nouveau?client=${client.id}`}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + Creer un devis
                </Link>
              </div>
              {devisArray.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">Aucun devis</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-gray-500 border-b">
                        <th className="pb-2 pr-4">Reference</th>
                        <th className="pb-2 pr-4 text-right">Montant TTC</th>
                        <th className="pb-2 pr-4 text-center">Statut</th>
                        <th className="pb-2 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devisArray.map((d) => {
                        const status = DEVIS_STATUS[d.status] || DEVIS_STATUS.brouillon
                        return (
                          <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="py-3 pr-4">
                              <Link href={`/devis/${d.id}`} className="text-blue-600 hover:underline font-mono text-sm">{d.reference}</Link>
                            </td>
                            <td className="py-3 pr-4 text-sm text-right font-medium">{formatEUR(d.montant_ttc)}</td>
                            <td className="py-3 pr-4 text-center">
                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                            </td>
                            <td className="py-3 text-sm text-right text-gray-500">{formatDate(d.created_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ---- COMMANDES TAB ---- */}
          {activeTab === 'commandes' && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Commandes ({commandes.length})</h2>
                <button
                  onClick={() => setShowCommandeForm(!showCommandeForm)}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + Nouvelle commande
                </button>
              </div>

              {showCommandeForm && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg border space-y-2">
                  <select
                    value={cmdForm.fournisseur}
                    onChange={(e) => setCmdForm({ ...cmdForm, fournisseur: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Fournisseur...</option>
                    {['Flexidoor', 'David Fermeture', 'Wibaie PVC', 'Wibaie ALU', 'Univers', 'Autre'].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Designation"
                    value={cmdForm.designation}
                    onChange={(e) => setCmdForm({ ...cmdForm, designation: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input type="date" value={cmdForm.date_commande} onChange={(e) => setCmdForm({ ...cmdForm, date_commande: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder="Date commande" />
                    <input type="text" value={cmdForm.delai_prevu} onChange={(e) => setCmdForm({ ...cmdForm, delai_prevu: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder="Delai prevu" />
                    <input type="date" value={cmdForm.date_livraison_prevue} onChange={(e) => setCmdForm({ ...cmdForm, date_livraison_prevue: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" placeholder="Livraison prevue" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCommandeForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Annuler</button>
                    <button onClick={handleAddCommande} disabled={!cmdForm.fournisseur} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">Ajouter</button>
                  </div>
                </div>
              )}

              {commandes.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">Aucune commande</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-gray-500 border-b">
                        <th className="pb-2 pr-4">Fournisseur</th>
                        <th className="pb-2 pr-4">Designation</th>
                        <th className="pb-2 pr-4">Date commande</th>
                        <th className="pb-2 pr-4">Livraison prevue</th>
                        <th className="pb-2 text-center">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commandes.map((c) => {
                        const status = COMMANDE_STATUS[c.status] || COMMANDE_STATUS.en_attente
                        return (
                          <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="py-3 pr-4 text-sm font-medium">{c.fournisseur}</td>
                            <td className="py-3 pr-4 text-sm text-gray-600">{c.designation || '--'}</td>
                            <td className="py-3 pr-4 text-sm text-gray-500">{formatDate(c.date_commande)}</td>
                            <td className="py-3 pr-4 text-sm text-gray-500">{formatDate(c.date_livraison_prevue)}</td>
                            <td className="py-3 text-center">
                              <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ---- SAV TAB ---- */}
          {activeTab === 'sav' && (
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">SAV ({savTickets.length})</h2>
                <button
                  onClick={() => setShowSavForm(!showSavForm)}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  + Nouveau ticket
                </button>
              </div>

              {showSavForm && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg border space-y-2">
                  <input
                    type="text"
                    placeholder="Sujet du ticket"
                    value={savForm.sujet}
                    onChange={(e) => setSavForm({ ...savForm, sujet: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <textarea
                    placeholder="Description..."
                    value={savForm.description}
                    onChange={(e) => setSavForm({ ...savForm, description: e.target.value })}
                    rows={3}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={savForm.priorite}
                      onChange={(e) => setSavForm({ ...savForm, priorite: e.target.value })}
                      className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="basse">Basse</option>
                      <option value="moyenne">Moyenne</option>
                      <option value="haute">Haute</option>
                      <option value="urgente">Urgente</option>
                    </select>
                    <select
                      value={savForm.commercial_id}
                      onChange={(e) => setSavForm({ ...savForm, commercial_id: e.target.value })}
                      className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Commercial...</option>
                      {commerciaux.map((c) => (
                        <option key={c.id} value={c.id}>{c.nom}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowSavForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Annuler</button>
                    <button onClick={handleAddSav} disabled={!savForm.sujet.trim()} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">Creer</button>
                  </div>
                </div>
              )}

              {savTickets.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-8">Aucun ticket SAV</p>
              ) : (
                <div className="space-y-3">
                  {savTickets.map((t) => {
                    const status = SAV_STATUS[t.status] || SAV_STATUS.ouvert
                    const prio = SAV_PRIORITE[t.priorite] || SAV_PRIORITE.moyenne
                    return (
                      <div key={t.id} className="p-3 rounded-lg border hover:border-gray-300 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900">{t.sujet}</p>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prio.color}`}>{prio.label}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.color}`}>{status.label}</span>
                          </div>
                        </div>
                        {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-gray-400">{formatDate(t.created_at)}</span>
                          {t.commerciaux?.nom && <span className="text-xs text-gray-400">assign. {t.commerciaux.nom}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============================================================= */}
        {/* RIGHT COLUMN */}
        {/* ============================================================= */}
        <div className="space-y-6">
          {/* Client info card */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Coordonnees</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Nom</label>
                <input
                  type="text"
                  value={editClient.nom}
                  onChange={(e) => setEditClient({ ...editClient, nom: e.target.value })}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Telephone</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editClient.telephone}
                    onChange={(e) => setEditClient({ ...editClient, telephone: e.target.value })}
                    className="flex-1 border rounded-lg px-3 py-1.5 text-sm mt-0.5 font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {editClient.telephone && (
                    <a href={`tel:${editClient.telephone}`} className="text-blue-600 hover:text-blue-800 text-lg mt-0.5">{'\u{1F4DE}'}</a>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Email</label>
                <input
                  type="email"
                  value={editClient.email}
                  onChange={(e) => setEditClient({ ...editClient, email: e.target.value })}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Adresse</label>
                <input
                  type="text"
                  value={editClient.adresse}
                  onChange={(e) => setEditClient({ ...editClient, adresse: e.target.value })}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Code postal</label>
                  <input
                    type="text"
                    value={editClient.code_postal}
                    onChange={(e) => setEditClient({ ...editClient, code_postal: e.target.value })}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Ville</label>
                  <input
                    type="text"
                    value={editClient.ville}
                    onChange={(e) => setEditClient({ ...editClient, ville: e.target.value })}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveContact}
                className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Enregistrer
              </button>
            </div>
          </div>

          {/* Assignment card */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Attribution</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Commercial</label>
                <select
                  value={client.commercial_id || ''}
                  onChange={(e) => handleCommercialChange(e.target.value)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Non assigne</option>
                  {commerciaux.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Source</label>
                <select
                  value={client.source || ''}
                  onChange={(e) => handleSourceChange(e.target.value)}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Non renseigne</option>
                  {SOURCE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Besoin</label>
                <textarea
                  value={editBesoin}
                  onChange={(e) => setEditBesoin(e.target.value)}
                  onBlur={handleBesoinBlur}
                  placeholder="Description du besoin..."
                  rows={2}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Montant estime</label>
                <div className="relative">
                  <input
                    type="number"
                    value={editMontant}
                    onChange={(e) => setEditMontant(e.target.value)}
                    onBlur={handleMontantBlur}
                    placeholder="0"
                    className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 pr-8 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 mt-0.5">{'\u20AC'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Next action card */}
          {nextAction && (
            <div className="bg-yellow-50 rounded-xl shadow-sm border border-yellow-200 p-6">
              <h2 className="text-sm font-semibold text-yellow-800 mb-2">{'\u23F0'} Prochaine action</h2>
              <p className="text-sm text-gray-900">{nextAction.contenu}</p>
              <p className="text-xs text-yellow-700 mt-1">
                {nextAction.type === 'rappel' ? 'Rappel' : 'Visite'} prevu le {formatDate(nextAction.date_prevue)}
              </p>
              <button
                onClick={() => handleMarkDone(nextAction.id)}
                className="mt-3 w-full bg-green-600 text-white py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                Fait {'\u2713'}
              </button>
            </div>
          )}

          {/* Quick actions card */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Actions rapides</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setActiveTab('activites'); setShowNoteForm(true); setShowRappelForm(false) }}
                className="flex items-center gap-2 p-2.5 rounded-lg border hover:bg-gray-50 text-sm transition-colors"
              >
                <span>{'\u{1F4DD}'}</span> Note
              </button>
              <button
                onClick={() => { setActiveTab('activites'); setShowRappelForm(true); setShowNoteForm(false) }}
                className="flex items-center gap-2 p-2.5 rounded-lg border hover:bg-gray-50 text-sm transition-colors"
              >
                <span>{'\u23F0'}</span> Rappel
              </button>
              <Link
                href={`/devis/nouveau?client=${client.id}`}
                className="flex items-center gap-2 p-2.5 rounded-lg border hover:bg-gray-50 text-sm transition-colors"
              >
                <span>{'\u{1F4C4}'}</span> Devis
              </Link>
              <button
                onClick={() => { setActiveTab('commandes'); setShowCommandeForm(true) }}
                className="flex items-center gap-2 p-2.5 rounded-lg border hover:bg-gray-50 text-sm transition-colors"
              >
                <span>{'\u{1F4E6}'}</span> Commande
              </button>
              <Link
                href="/planning"
                className="flex items-center gap-2 p-2.5 rounded-lg border hover:bg-gray-50 text-sm transition-colors col-span-2"
              >
                <span>{'\u{1F527}'}</span> Pose
              </Link>
            </div>
          </div>

          {/* Resume + danger zone */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Resume</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Devis</span>
                <span className="font-medium">{devisArray.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Signes</span>
                <span className="font-medium text-green-600">{devisArray.filter((d) => d.status === 'signe').length}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-gray-500">CA total</span>
                <span className="font-bold">
                  {formatEUR(devisArray.filter((d) => d.status === 'signe').reduce((sum, d) => sum + (d.montant_ttc || 0), 0))}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-xs text-gray-500">Cree le {formatDate(client.created_at)}</p>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="w-full text-red-600 border border-red-200 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Suppression...' : 'Supprimer ce client'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
