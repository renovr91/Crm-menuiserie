'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Client {
  id: string
  nom: string
  telephone: string | null
}

interface Commande {
  id: string
  client_id: string
  fournisseur: string
  designation: string | null
  date_commande: string | null
  date_livraison_prevue: string | null
  status: string
  notes: string | null
  clients: { nom: string; telephone: string | null } | null
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  en_attente: { label: 'En attente', color: 'bg-gray-100 text-gray-700' },
  commandee: { label: 'Commandee', color: 'bg-blue-100 text-blue-700' },
  en_fabrication: { label: 'En fabrication', color: 'bg-amber-100 text-amber-700' },
  expediee: { label: 'Expediee', color: 'bg-purple-100 text-purple-700' },
  livree: { label: 'Livree', color: 'bg-green-100 text-green-700' },
}

const FOURNISSEURS = ['Flexidoor', 'David Fermeture', 'Wibaie PVC', 'Wibaie ALU', 'Univers']

export default function LivraisonsPage() {
  const router = useRouter()
  const [commandes, setCommandes] = useState<Commande[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [filterFournisseur, setFilterFournisseur] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    client_id: '',
    fournisseur: '',
    designation: '',
    date_commande: '',
    delai_prevu: '',
    date_livraison_prevue: '',
  })

  const loadCommandes = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterFournisseur) params.set('fournisseur', filterFournisseur)
      if (filterStatus) params.set('status', filterStatus)
      const res = await fetch(`/api/commandes?${params}`)
      if (res.ok) {
        const data = await res.json()
        setCommandes(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filterFournisseur, filterStatus])

  const loadClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients')
      if (res.ok) {
        const data = await res.json()
        setClients(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadCommandes() }, [loadCommandes])
  useEffect(() => { loadClients() }, [loadClients])

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`/api/commandes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadCommandes()
    } catch { /* ignore */ }
  }

  async function handleCreate() {
    if (!formData.client_id || !formData.fournisseur) return
    try {
      const res = await fetch('/api/commandes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      if (res.ok) {
        setShowModal(false)
        setFormData({ client_id: '', fournisseur: '', designation: '', date_commande: '', delai_prevu: '', date_livraison_prevue: '' })
        loadCommandes()
      }
    } catch { /* ignore */ }
  }

  function isOverdue(c: Commande): boolean {
    if (!c.date_livraison_prevue || c.status === 'livree') return false
    return new Date(c.date_livraison_prevue) < new Date()
  }

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '--'

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Livraisons</h1>
          <p className="text-sm text-gray-500 mt-1">{commandes.length} commande{commandes.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          + Nouvelle commande
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={filterFournisseur}
          onChange={(e) => setFilterFournisseur(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Tous les fournisseurs</option>
          {FOURNISSEURS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
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
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Chargement...</p>
        </div>
      ) : commandes.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Aucune commande</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-4 text-sm font-medium text-gray-500">Client</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Fournisseur</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Produits</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Commande le</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Livraison prevue</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody>
              {commandes.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b last:border-0 hover:bg-gray-50 ${isOverdue(c) ? 'bg-red-50' : ''}`}
                >
                  <td className="p-4">
                    <button
                      onClick={() => router.push(`/clients/${c.client_id}`)}
                      className="text-blue-600 hover:underline font-medium text-sm"
                    >
                      {c.clients?.nom || '--'}
                    </button>
                  </td>
                  <td className="p-4 text-sm">{c.fournisseur}</td>
                  <td className="p-4 text-sm text-gray-600">{c.designation || '--'}</td>
                  <td className="p-4 text-sm text-gray-500">{formatDate(c.date_commande)}</td>
                  <td className={`p-4 text-sm ${isOverdue(c) ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {formatDate(c.date_livraison_prevue)}
                  </td>
                  <td className="p-4">
                    <select
                      value={c.status}
                      onChange={(e) => updateStatus(c.id, e.target.value)}
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_MAP[c.status]?.color || 'bg-gray-100 text-gray-700'}`}
                    >
                      {Object.entries(STATUS_MAP).map(([key, { label }]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Nouvelle commande</h2>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Fournisseur *</label>
                <select
                  value={formData.fournisseur}
                  onChange={(e) => setFormData({ ...formData, fournisseur: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Selectionner un fournisseur</option>
                  {FOURNISSEURS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
                <input
                  type="text"
                  value={formData.designation}
                  onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Ex: 3 VR DP45 + 2 fenetres PVC"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date commande</label>
                  <input
                    type="date"
                    value={formData.date_commande}
                    onChange={(e) => setFormData({ ...formData, date_commande: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delai prevu</label>
                  <input
                    type="text"
                    value={formData.delai_prevu}
                    onChange={(e) => setFormData({ ...formData, delai_prevu: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Ex: 6 semaines"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Livraison prevue</label>
                <input
                  type="date"
                  value={formData.date_livraison_prevue}
                  onChange={(e) => setFormData({ ...formData, date_livraison_prevue: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
              <button
                onClick={handleCreate}
                disabled={!formData.client_id || !formData.fournisseur}
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
