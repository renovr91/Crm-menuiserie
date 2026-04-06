'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoye', color: 'bg-blue-100 text-blue-700' },
  lu: { label: 'Lu', color: 'bg-yellow-100 text-yellow-700' },
  signe: { label: 'Signe', color: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refuse', color: 'bg-red-100 text-red-700' },
  expire: { label: 'Expire', color: 'bg-gray-100 text-gray-500' },
}

const ALL_STATUSES = ['brouillon', 'envoye', 'lu', 'signe', 'refuse', 'expire']

interface Devis {
  id: string; reference: string; status: string; montant_ttc: number; created_at: string
  clients: { nom: string; telephone: string } | null
}

export default function DevisListPage() {
  const [devisList, setDevisList] = useState<Devis[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/devis')
      .then((res) => res.json())
      .then((data) => setDevisList(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = devisList.filter((d) => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false
    if (search) {
      const q = search.toLowerCase()
      const match = d.reference?.toLowerCase().includes(q) ||
        d.clients?.nom?.toLowerCase().includes(q) ||
        d.clients?.telephone?.includes(q)
      if (!match) return false
    }
    return true
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Devis</h1>
        <Link href="/devis/nouveau" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">+ Nouveau devis</Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (ref, client, tel)..."
          className="border rounded-lg px-3 py-2 text-sm w-64 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="flex gap-1 bg-white border rounded-lg p-1">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${filterStatus === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
          >Tous</button>
          {ALL_STATUSES.map((s) => {
            const label = STATUS_LABELS[s]
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${filterStatus === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              >{label.label}</button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 mb-4">{devisList.length === 0 ? 'Aucun devis pour l\'instant' : 'Aucun resultat'}</p>
          {devisList.length === 0 && <Link href="/devis/nouveau" className="text-blue-600 hover:underline text-sm">Creer votre premier devis</Link>}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b bg-gray-50">
              <th className="text-left p-4 text-sm font-medium text-gray-500">Reference</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Client</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Montant TTC</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Statut</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Date</th>
            </tr></thead>
            <tbody>
              {filtered.map((devis) => {
                const status = STATUS_LABELS[devis.status] || STATUS_LABELS.brouillon
                return (
                  <tr key={devis.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-4"><Link href={`/devis/${devis.id}`} className="text-blue-600 hover:underline font-mono text-sm">{devis.reference}</Link></td>
                    <td className="p-4"><p className="font-medium text-sm">{devis.clients?.nom || '\u2014'}</p><p className="text-gray-500 text-xs">{devis.clients?.telephone || ''}</p></td>
                    <td className="p-4 font-medium text-sm">{devis.montant_ttc?.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) || '\u2014'}</td>
                    <td className="p-4"><span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span></td>
                    <td className="p-4 text-sm text-gray-500">{new Date(devis.created_at).toLocaleDateString('fr-FR')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
