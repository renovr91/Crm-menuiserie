'use client'

import { useState, useEffect, useCallback } from 'react'

interface QontoTransaction {
  id: string
  transaction_id: string
  amount: number
  label: string
  reference: string | null
  side: string
  status: string
  settled_at: string | null
  operation_type: string
}

interface Devis {
  id: string
  reference: string
  montant_ht: number
  montant_ttc: number
  acompte_pct: number | null
  status: string
  payment_status: string | null
  signed_at: string | null
  created_at: string
  clients: { nom: string } | null
}

const eur = (v: number) =>
  Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

const dateFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

export default function QontoPage() {
  const [transactions, setTransactions] = useState<QontoTransaction[]>([])
  const [devisList, setDevisList] = useState<Devis[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    matched: number
    checked_transactions: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [matchingTxId, setMatchingTxId] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [txRes, devisRes] = await Promise.all([
        fetch('/api/qonto/transactions'),
        fetch('/api/devis'),
      ])

      if (!txRes.ok) {
        const err = await txRes.json()
        throw new Error(err.error || 'Erreur chargement transactions')
      }

      const txData = await txRes.json()
      const devisData = await devisRes.json()

      setTransactions(txData)
      setDevisList(Array.isArray(devisData) ? devisData : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/qonto/sync')
      const data = await res.json()
      setSyncResult(data)
      setLastSync(new Date().toLocaleTimeString('fr-FR'))
      await fetchData()
    } catch {
      setError('Erreur lors de la synchronisation')
    } finally {
      setSyncing(false)
    }
  }

  const handleMatch = async (
    tx: QontoTransaction,
    devisId: string
  ) => {
    try {
      const res = await fetch('/api/qonto/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devis_id: devisId,
          montant: tx.amount,
          transaction_id: tx.transaction_id || tx.id,
          settled_at: tx.settled_at,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Erreur lors du rapprochement')
        return
      }

      setMatchingTxId(null)
      await fetchData()
    } catch {
      alert('Erreur lors du rapprochement')
    }
  }

  // Devis en attente de paiement
  const devisEnAttente = devisList.filter(
    (d) =>
      d.status === 'signe' &&
      d.payment_status !== 'paye'
  )

  // Devis non payés (pour le dropdown de matching)
  const devisNonPayes = devisList.filter(
    (d) => d.payment_status !== 'paye' && d.reference
  )

  // Check if a transaction matches a devis reference
  const findMatchedDevis = (tx: QontoTransaction) => {
    const label = (tx.label || '').toLowerCase()
    const ref = (tx.reference || '').toLowerCase()
    return devisList.find((d) => {
      if (!d.reference || d.payment_status !== 'paye') return false
      const dRef = d.reference.toLowerCase()
      return label.includes(dRef) || ref.includes(dRef)
    })
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">🏦</span> Qonto
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Virements bancaires et rapprochement devis
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastSync && (
            <span className="text-xs text-gray-400">
              Derniere synchro : {lastSync}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={syncing ? 'animate-spin' : ''}>🔄</span>
            {syncing ? 'Synchronisation...' : 'Synchroniser'}
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
          <strong>{syncResult.matched}</strong> virement(s) rapproche(s) sur{' '}
          <strong>{syncResult.checked_transactions}</strong> transactions
          verifiees.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Transactions (2/3) */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                Virements recus — 30 derniers jours
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {transactions.length} transaction(s)
              </p>
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Chargement des transactions...
              </div>
            ) : transactions.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Aucun virement recu ces 30 derniers jours
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Expediteur / Label
                      </th>
                      <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reference
                      </th>
                      <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                        Montant
                      </th>
                      <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Statut
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {transactions.map((tx) => {
                      const matched = findMatchedDevis(tx)
                      return (
                        <tr
                          key={tx.id}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                            {tx.settled_at ? dateFr(tx.settled_at) : '—'}
                          </td>
                          <td className="px-5 py-3 text-gray-900 font-medium">
                            {tx.label || '—'}
                          </td>
                          <td className="px-5 py-3 text-gray-500 font-mono text-xs">
                            {tx.reference || '—'}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-green-600 whitespace-nowrap">
                            +{eur(tx.amount)}
                          </td>
                          <td className="px-5 py-3">
                            {matched ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                Matchee — {matched.reference}
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                  Non matchee
                                </span>
                                {matchingTxId === tx.id ? (
                                  <div className="flex items-center gap-1">
                                    <select
                                      className="text-xs border border-gray-300 rounded px-1.5 py-0.5 max-w-[280px]"
                                      defaultValue=""
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          handleMatch(tx, e.target.value)
                                        }
                                      }}
                                    >
                                      <option value="" disabled>
                                        Choisir une affaire
                                      </option>
                                      {devisNonPayes.map((d) => (
                                        <option key={d.id} value={d.id}>
                                          {d.reference} — {d.clients?.nom || 'Client'} — {eur(d.montant_ttc)}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      onClick={() => setMatchingTxId(null)}
                                      className="text-gray-400 hover:text-gray-600 text-xs"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setMatchingTxId(tx.id)}
                                    className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                                  >
                                    Lier à une affaire
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column — Devis en attente (1/3) */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">
                Devis en attente de virement
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {devisEnAttente.length} devis signe(s) non paye(s)
              </p>
            </div>

            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                Chargement...
              </div>
            ) : devisEnAttente.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                Aucun devis en attente de paiement
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {devisEnAttente.map((d) => {
                  const montantAttendu =
                    d.acompte_pct && d.acompte_pct > 0
                      ? (d.montant_ttc * d.acompte_pct) / 100
                      : d.montant_ttc
                  return (
                    <div
                      key={d.id}
                      className="px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-900">
                          {d.reference}
                        </span>
                        <span className="text-sm font-bold text-blue-600">
                          {eur(montantAttendu)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {d.clients?.nom || 'Client inconnu'}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {d.acompte_pct && d.acompte_pct > 0 && (
                          <span className="mr-2">
                            Acompte {d.acompte_pct}% sur{' '}
                            {eur(d.montant_ttc)}
                          </span>
                        )}
                        {d.signed_at
                          ? `Signe le ${dateFr(d.signed_at)}`
                          : d.created_at
                          ? `Cree le ${dateFr(d.created_at)}`
                          : ''}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
