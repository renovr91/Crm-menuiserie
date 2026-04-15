'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Client {
  id: string
  nom: string
}

interface Commercial {
  id: string
  nom: string
}

interface Pose {
  id: string
  client_id: string
  date_pose: string | null
  heure_debut: string | null
  adresse: string | null
  status: string
  notes: string | null
  clients: { nom: string; telephone: string | null; adresse: string | null } | null
  commerciaux: { nom: string } | null
  commandes: { designation: string } | null
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  planifiee: { label: 'Planifiee', color: 'bg-blue-100 text-blue-700' },
  en_cours: { label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  terminee: { label: 'Terminee', color: 'bg-green-100 text-green-700' },
  reportee: { label: 'Reportee', color: 'bg-red-100 text-red-700' },
}

export default function PlanningPage() {
  const router = useRouter()
  const [poses, setPoses] = useState<Pose[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCommercial, setFilterCommercial] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    client_id: '',
    date_pose: '',
    heure_debut: '',
    adresse: '',
    commercial_id: '',
    notes: '',
  })

  const loadPoses = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterCommercial) params.set('commercial_id', filterCommercial)
      const res = await fetch(`/api/poses?${params}`)
      if (res.ok) {
        const data = await res.json()
        setPoses(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filterCommercial])

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

  useEffect(() => { loadPoses() }, [loadPoses])
  useEffect(() => { loadClients(); loadCommerciaux() }, [loadClients, loadCommerciaux])

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`/api/poses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadPoses()
    } catch { /* ignore */ }
  }

  async function handleCreate() {
    if (!formData.client_id) return
    try {
      const res = await fetch('/api/poses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          commercial_id: formData.commercial_id || null,
        }),
      })
      if (res.ok) {
        setShowModal(false)
        setFormData({ client_id: '', date_pose: '', heure_debut: '', adresse: '', commercial_id: '', notes: '' })
        loadPoses()
      }
    } catch { /* ignore */ }
  }

  function isToday(d: string | null): boolean {
    if (!d) return false
    const today = new Date().toISOString().split('T')[0]
    return d.startsWith(today)
  }

  function isPastUnfinished(p: Pose): boolean {
    if (!p.date_pose || p.status === 'terminee') return false
    const today = new Date().toISOString().split('T')[0]
    return p.date_pose < today
  }

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '--'

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Planning des poses</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          + Nouvelle pose
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={filterCommercial}
          onChange={(e) => setFilterCommercial(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Tous les poseurs</option>
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
      ) : poses.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Aucune pose planifiee</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-4 text-sm font-medium text-gray-500">Date</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Heure</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Client</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Adresse</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Produits</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Poseur</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody>
              {poses.map((p) => {
                const todayRow = isToday(p.date_pose)
                const overdueRow = isPastUnfinished(p)
                return (
                  <tr
                    key={p.id}
                    className={`border-b last:border-0 hover:bg-gray-50 ${overdueRow ? 'bg-red-50' : todayRow ? 'bg-blue-50' : ''}`}
                  >
                    <td className={`p-4 text-sm ${todayRow ? 'font-semibold text-blue-700' : 'text-gray-500'}`}>
                      {formatDate(p.date_pose)}
                    </td>
                    <td className="p-4 text-sm text-gray-500">{p.heure_debut || '--'}</td>
                    <td className="p-4">
                      <button
                        onClick={() => router.push(`/clients/${p.client_id}`)}
                        className="text-blue-600 hover:underline font-medium text-sm"
                      >
                        {p.clients?.nom || '--'}
                      </button>
                    </td>
                    <td className="p-4 text-sm text-gray-500">{p.adresse || p.clients?.adresse || '--'}</td>
                    <td className="p-4 text-sm text-gray-600">{p.commandes?.designation || '--'}</td>
                    <td className="p-4 text-sm">{p.commerciaux?.nom || '--'}</td>
                    <td className="p-4">
                      <select
                        value={p.status}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_MAP[p.status]?.color || 'bg-gray-100 text-gray-700'}`}
                      >
                        {Object.entries(STATUS_MAP).map(([key, { label }]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Nouvelle pose</h2>
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={formData.date_pose}
                    onChange={(e) => setFormData({ ...formData, date_pose: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure</label>
                  <input
                    type="time"
                    value={formData.heure_debut}
                    onChange={(e) => setFormData({ ...formData, heure_debut: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
                <input
                  type="text"
                  value={formData.adresse}
                  onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Adresse du chantier"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Poseur / Commercial</label>
                <select
                  value={formData.commercial_id}
                  onChange={(e) => setFormData({ ...formData, commercial_id: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Selectionner</option>
                  {commerciaux.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Notes complementaires..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
              <button
                onClick={handleCreate}
                disabled={!formData.client_id}
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
