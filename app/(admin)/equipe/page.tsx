'use client'

import { useState, useEffect, useCallback } from 'react'

interface Commercial {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  couleur: string
  actif: boolean
}

interface Client {
  id: string
  commercial_id: string | null
  pipeline_stage: string | null
}

const COLOR_PRESETS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
]

export default function EquipePage() {
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    nom: '',
    telephone: '',
    email: '',
    couleur: '#3b82f6',
  })

  const loadCommerciaux = useCallback(async () => {
    try {
      const res = await fetch('/api/commerciaux')
      if (res.ok) {
        const data = await res.json()
        setCommerciaux(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  const loadClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients')
      if (res.ok) {
        const data = await res.json()
        setClients(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadCommerciaux(); loadClients() }, [loadCommerciaux, loadClients])

  function getActiveLeads(commercialId: string): number {
    const excludedStages = ['termine', 'perdu']
    return clients.filter(
      (c) => c.commercial_id === commercialId && !excludedStages.includes(c.pipeline_stage || '')
    ).length
  }

  function openCreate() {
    setEditingId(null)
    setFormData({ nom: '', telephone: '', email: '', couleur: '#3b82f6' })
    setShowModal(true)
  }

  function openEdit(c: Commercial) {
    setEditingId(c.id)
    setFormData({
      nom: c.nom,
      telephone: c.telephone || '',
      email: c.email || '',
      couleur: c.couleur || '#3b82f6',
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!formData.nom) return
    try {
      const url = editingId ? `/api/commerciaux/${editingId}` : '/api/commerciaux'
      const method = editingId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: formData.nom,
          telephone: formData.telephone || null,
          email: formData.email || null,
          couleur: formData.couleur,
        }),
      })
      if (res.ok) {
        setShowModal(false)
        loadCommerciaux()
      }
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Equipe commerciale</h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          + Ajouter
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Chargement...</p>
        </div>
      ) : commerciaux.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 mb-4">Aucun membre dans l&apos;equipe</p>
          <button onClick={openCreate} className="text-blue-600 hover:underline text-sm">
            Ajouter le premier membre
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {commerciaux.map((c) => {
            const leads = getActiveLeads(c.id)
            return (
              <div
                key={c.id}
                className="bg-white rounded-xl shadow-sm border p-6 relative group"
              >
                {/* Edit button */}
                <button
                  onClick={() => openEdit(c)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Modifier"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>

                {/* Color dot + name */}
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.couleur || '#3b82f6' }}
                  />
                  <h3 className="text-lg font-bold text-gray-900">{c.nom}</h3>
                </div>

                {/* Contact info */}
                <div className="space-y-1.5 mb-4">
                  {c.telephone && (
                    <p className="text-sm text-gray-500 font-mono">{c.telephone}</p>
                  )}
                  {c.email && (
                    <p className="text-sm text-gray-500 truncate">{c.email}</p>
                  )}
                  {!c.telephone && !c.email && (
                    <p className="text-sm text-gray-400 italic">Aucun contact</p>
                  )}
                </div>

                {/* Stats */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Leads actifs</span>
                    <span className="text-sm font-semibold text-gray-900">{leads}</span>
                  </div>
                </div>

                {/* Actif badge */}
                <div className="mt-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${c.actif !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.actif !== false ? 'Actif' : 'Inactif'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">
              {editingId ? 'Modifier le membre' : 'Ajouter un membre'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                <input
                  type="text"
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Nom complet"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telephone</label>
                <input
                  type="text"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ ...formData, telephone: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="06 12 34 56 78"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="email@exemple.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Couleur</label>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    {COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setFormData({ ...formData, couleur: color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${formData.couleur === color ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={formData.couleur}
                    onChange={(e) => setFormData({ ...formData, couleur: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border-0"
                    title="Couleur personnalisee"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuler</button>
              <button
                onClick={handleSave}
                disabled={!formData.nom}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {editingId ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
