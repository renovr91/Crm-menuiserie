'use client'

import { useEffect, useMemo, useState } from 'react'

interface DevisClaudus {
  numero: string
  created_by: string | null
  client_nom: string | null
  client_telephone: string | null
  client_ville: string | null
  reference: string | null
  delai: string | null
  montant_ht: number | null
  montant_ttc: number | null
  pdf_path: string | null
  pdf_filename: string | null
  created_at: string
}

function eur(v: number | null | undefined) {
  const n = Number(v || 0)
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch {
    return iso.slice(0, 10)
  }
}

export default function DevisClaudusPage() {
  const [devis, setDevis] = useState<DevisClaudus[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [hasPdfOnly, setHasPdfOnly] = useState(false)

  useEffect(() => {
    fetch('/api/devis-claudus?limit=500')
      .then((res) => res.json())
      .then((data) => setDevis(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const allUsers = useMemo(() => {
    const set = new Set<string>()
    devis.forEach((d) => d.created_by && set.add(d.created_by))
    return Array.from(set).sort()
  }, [devis])

  const filtered = useMemo(() => {
    return devis.filter((d) => {
      if (userFilter !== 'all' && d.created_by !== userFilter) return false
      if (hasPdfOnly && !d.pdf_path) return false
      if (search) {
        const q = search.toLowerCase()
        const match =
          d.numero.toLowerCase().includes(q) ||
          d.client_nom?.toLowerCase().includes(q) ||
          d.reference?.toLowerCase().includes(q) ||
          d.client_ville?.toLowerCase().includes(q) ||
          d.client_telephone?.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [devis, userFilter, hasPdfOnly, search])

  const stats = useMemo(() => {
    const total = filtered.length
    const totalTTC = filtered.reduce((s, d) => s + Number(d.montant_ttc || 0), 0)
    const withPdf = filtered.filter((d) => d.pdf_path).length
    return { total, totalTTC, withPdf }
  }, [filtered])

  async function handleDownload(numero: string) {
    try {
      const res = await fetch(`/api/devis-claudus/${encodeURIComponent(numero)}/download`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }))
        alert('Download impossible : ' + (err.error || res.statusText))
        return
      }
      const { url, filename } = await res.json()
      // Ouvre dans nouvel onglet — le header download force le téléchargement
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      if (filename) a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) {
      alert('Erreur : ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Devis Claudus</h1>
          <p className="text-sm text-gray-500 mt-1">
            Devis générés via l&apos;outil CLI — partagés entre tous les Macs
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="bg-white border rounded-lg px-3 py-1.5">
            <span className="text-gray-500">Total : </span>
            <span className="font-semibold">{stats.total}</span>
          </div>
          <div className="bg-white border rounded-lg px-3 py-1.5">
            <span className="text-gray-500">CA TTC : </span>
            <span className="font-semibold">{eur(stats.totalTTC)}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (n°, client, réf, ville, tel)..."
          className="border rounded-lg px-3 py-2 text-sm w-72 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />

        <div className="flex gap-1 bg-white border rounded-lg p-1">
          <button
            onClick={() => setUserFilter('all')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              userFilter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Tous les users
          </button>
          {allUsers.map((u) => (
            <button
              key={u}
              onClick={() => setUserFilter(u)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                userFilter === u ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {u}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasPdfOnly}
            onChange={(e) => setHasPdfOnly(e.target.checked)}
            className="rounded"
          />
          Avec PDF uniquement
        </label>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-gray-500">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 mb-2">
            {devis.length === 0 ? 'Aucun devis Claudus pour l\'instant' : 'Aucun résultat avec ces filtres'}
          </p>
          {devis.length === 0 && (
            <p className="text-xs text-gray-400">
              Génère un devis via le CLI (<code className="bg-gray-100 px-1 py-0.5 rounded">python3 generate_devis.py</code>) — il apparaîtra ici automatiquement.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">N°</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Commercial</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Référence</th>
                <th className="text-right p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Montant TTC</th>
                <th className="text-center p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((d) => (
                <tr key={d.numero} className="hover:bg-gray-50 transition-colors">
                  <td className="p-3 text-sm font-mono font-semibold">{d.numero}</td>
                  <td className="p-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(d.created_at)}</td>
                  <td className="p-3 text-sm">
                    {d.created_by ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {d.created_by}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-sm">
                    <div className="font-medium text-gray-900">{d.client_nom || '—'}</div>
                    {(d.client_telephone || d.client_ville) && (
                      <div className="text-xs text-gray-500">
                        {[d.client_telephone, d.client_ville].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-sm text-gray-600 max-w-xs truncate">{d.reference || '—'}</td>
                  <td className="p-3 text-sm font-semibold text-right whitespace-nowrap">{eur(d.montant_ttc)}</td>
                  <td className="p-3 text-center">
                    {d.pdf_path ? (
                      <button
                        onClick={() => handleDownload(d.numero)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                        title="Télécharger le PDF"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                        </svg>
                        PDF
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400" title="PDF pas encore uploadé (peut-être sur un autre Mac)">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats.withPdf < stats.total && (
        <p className="text-xs text-gray-400 mt-3">
          ℹ️ {stats.total - stats.withPdf} devis sans PDF dans le cloud (générés avant la synchronisation ou sur un Mac non migré).
        </p>
      )}
    </div>
  )
}
