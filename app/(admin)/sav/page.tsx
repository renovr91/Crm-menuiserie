'use client'

import { useState, useEffect, useCallback } from 'react'

interface Client {
  id: string
  nom: string
}

interface Commercial {
  id: string
  nom: string
}

interface SavTicket {
  id: string
  client_id: string
  commercial_id: string | null
  sujet: string
  description: string | null
  priorite: string
  status: string
  notes: string | null
  created_at: string
  clients: { nom: string; telephone: string | null } | null
  commerciaux: { nom: string } | null
}

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  urgente: { label: 'Urgente', color: 'bg-red-100 text-red-700' },
  haute: { label: 'Haute', color: 'bg-orange-100 text-orange-700' },
  moyenne: { label: 'Moyenne', color: 'bg-yellow-100 text-yellow-700' },
  basse: { label: 'Basse', color: 'bg-gray-100 text-gray-700' },
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ouvert: { label: 'Ouvert', color: 'bg-red-100 text-red-700' },
  en_cours: { label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  resolu: { label: 'Resolu', color: 'bg-green-100 text-green-700' },
  ferme: { label: 'Ferme', color: 'bg-gray-100 text-gray-500' },
}

export default function SavPage() {
  const [tickets, setTickets] = useState<SavTicket[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPriorite, setFilterPriorite] = useState('')
  const [filterCommercial, setFilterCommercial] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    client_id: '',
    sujet: '',
    description: '',
    priorite: 'moyenne',
    commercial_id: '',
  })

  const loadTickets = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterPriorite) params.set('priorite', filterPriorite)
      if (filterCommercial) params.set('commercial_id', filterCommercial)
      const res = await fetch(`/api/sav?${params}`)
      if (res.ok) {
        const data = await res.json()
        setTickets(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filterStatus, filterPriorite, filterCommercial])

  const loadClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients')
      if (res.ok) {
        const data = await res.json()
        setClients(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  const loadCommerciaux = useCallback(async () => {
    try {
      const res = await fetch('/api/commerciaux')
      if (res.ok) {
        const data = await res.json()
        setCommerciaux(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadTickets() }, [loadTickets])
  useEffect(() => { loadClients(); loadCommerciaux() }, [loadClients, loadCommerciaux])

  async function updateTicket(id: string, updates: Record<string, string | null>) {
    try {
      await fetch(`/api/sav/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      loadTickets()
    } catch { /* ignore */ }
  }

  async function handleCreate() {
    if (!formData.client_id || !formData.sujet) return
    try {
      const res = await fetch('/api/sav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          commercial_id: formData.commercial_id || null,
        }),
      })
      if (res.ok) {
        setShowModal(false)
        setFormData({ client_id: '', sujet: '', description: '', priorite: 'moyenne', commercial_id: '' })
        loadTickets()
      }
    } catch { /* ignore */ }
  }

  function toggleExpand(ticket: SavTicket) {
    if (expandedId === ticket.id) {
      setExpandedId(null)
    } else {
      setExpandedId(ticket.id)
      setEditNotes(ticket.notes || '')
    }
  }

  const openCount = tickets.filter((t) => t.status === 'ouvert' || t.status === 'en_cours').length
  const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR')

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">SAV</h1>
          <p className="text-sm text-gray-500 mt-1">{openCount} ticket{openCount !== 1 ? 's' : ''} ouvert{openCount !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          + Nouveau ticket
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_MAP).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={filterPriorite}
          onChange={(e) => setFilterPriorite(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Toutes les priorites</option>
          {Object.entries(PRIORITY_MAP).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select
          value={filterCommercial}
          onChange={(e) => setFilterCommercial(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Tous les commerciaux</option>
          {commerciaux.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Chargement...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Aucun ticket SAV</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-4 text-sm font-medium text-gray-500">Client</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Sujet</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Priorite</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Assigne a</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Statut</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Cree le</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <>
                  <tr
                    key={t.id}
                    onClick={() => toggleExpand(t)}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="p-4 text-sm font-medium">{t.clients?.nom || '--'}</td>
                    <td className="p-4 text-sm text-gray-700">{t.sujet}</td>
                    <td className="p-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${PRIORITY_MAP[t.priorite]?.color || 'bg-gray-100 text-gray-700'}`}>
                        {PRIORITY_MAP[t.priorite]?.label || t.priorite}
                      </span>
                    </td>
                    <td className="p-4 text-sm">{t.commerciaux?.nom || '--'}</td>
                    <td className="p-4">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_MAP[t.status]?.color || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_MAP[t.status]?.label || t.status}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-gray-500">{formatDate(t.created_at)}</td>
                  </tr>
                  {expandedId === t.id && (
                    <tr key={`${t.id}-detail`} className="border-b bg-gray-50">
                      <td colSpan={6} className="p-6">
                        <div className="space-y-4">
                          {t.description && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-1">Description</h4>
                              <p className="text-sm text-gray-600 whitespace-pre-wrap">{t.description}</p>
                            </div>
                          )}
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">Statut</h4>
                            <select
                              value={t.status}
                              onChange={(e) => {
                                e.stopPropagation()
                                updateTicket(t.id, { status: e.target.value })
                              }}
                              className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_MAP[t.status]?.color || 'bg-gray-100 text-gray-700'}`}
                            >
                              {Object.entries(STATUS_MAP).map(([key, { label }]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">Notes</h4>
                            <textarea
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="w-full border rounded-lg px-3 py-2 text-sm"
                              rows={3}
                              placeholder="Ajouter des notes..."
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                updateTicket(t.id, { notes: editNotes })
                              }}
                              className="mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                            >
                              Enregistrer
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Nouveau ticket SAV</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
                <select
                  value={formData.client_id}
                  onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Selectionner un client</option>
                  {clients.map((cl) => (
                    <option key={cl.id} value={cl.id}>{cl.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sujet *</label>
                <input
                  type="text"
                  value={formData.sujet}
                  onChange={(e) => setFormData({ ...formData, sujet: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: Defaut etancheite fenetre salon"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={4}
                  placeholder="Details du probleme..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priorite</label>
                  <select
                    value={formData.priorite}
                    onChange={(e) => setFormData({ ...formData, priorite: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {Object.entries(PRIORITY_MAP).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assigne a</label>
                  <select
                    value={formData.commercial_id}
                    onChange={(e) => setFormData({ ...formData, commercial_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Non assigne</option>
                    {commerciaux.map((c) => (
                      <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
              <button
                onClick={handleCreate}
                disabled={!formData.client_id || !formData.sujet}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                Creer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
