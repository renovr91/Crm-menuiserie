'use client'

import { useState, useEffect, useCallback } from 'react'
import CallRow from './CallRow'
import CreateAffaireModal from './CreateAffaireModal'
import type { RingoverCallWithTranscript, TranscribeApiResponse } from './types'

type Period = 'today' | 'week' | 'month' | 'all'
type DirectionFilter = 'all' | 'in' | 'out'

export default function TelephoniePage() {
  const [calls, setCalls] = useState<RingoverCallWithTranscript[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [period, setPeriod] = useState<Period>('week')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  const [missedOnly, setMissedOnly] = useState(false)
  const [modalCdrId, setModalCdrId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('period', period)
      if (direction !== 'all') params.set('direction', direction)
      if (missedOnly) params.set('missed', 'true')
      const r = await fetch(`/api/ringover/calls?${params}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'load failed')
      setCalls((data.calls || []) as RingoverCallWithTranscript[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }, [period, direction, missedOnly])

  useEffect(() => {
    load()
  }, [load])

  async function handleSync() {
    setSyncing(true)
    setError(null)
    try {
      const r = await fetch('/api/ringover/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'sync failed')
      setToast(`✅ ${data.synced} appels synchronisés`)
      window.setTimeout(() => setToast(null), 3000)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setSyncing(false)
    }
  }

  function handleTranscribed(cdr_id: number, data: TranscribeApiResponse) {
    setCalls((prev) =>
      prev.map((c) =>
        c.cdr_id === cdr_id
          ? {
              ...c,
              transcript: {
                cdr_id,
                transcript_text: data.transcript,
                summary: data.summary,
                extracted: data.extracted,
                audio_duration_s: null,
                voxtral_model: null,
                summary_model: null,
                created_at: new Date().toISOString(),
              },
            }
          : c,
      ),
    )
  }

  function handleCreateAffaire(cdr_id: number) {
    setModalCdrId(cdr_id)
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span>📞</span> Téléphonie
          <span className="text-xs opacity-50 font-normal">Ringover</span>
        </h1>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50"
        >
          {syncing ? '⏳ Sync...' : '🔄 Refresh'}
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap items-center text-sm">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Period)}
          className="border rounded px-3 py-1 bg-transparent"
          style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
        >
          <option value="today">Aujourd&apos;hui</option>
          <option value="week">7 jours</option>
          <option value="month">30 jours</option>
          <option value="all">Tout</option>
        </select>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as DirectionFilter)}
          className="border rounded px-3 py-1 bg-transparent"
          style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
        >
          <option value="all">Tous sens</option>
          <option value="in">Entrants</option>
          <option value="out">Sortants</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={missedOnly}
            onChange={(e) => setMissedOnly(e.target.checked)}
          />
          <span>Manqués seulement</span>
        </label>
        <span className="opacity-50 text-xs ml-auto">
          {calls.length} appel{calls.length > 1 ? 's' : ''}
        </span>
      </div>

      {toast && (
        <div className="mb-3 p-2 rounded bg-emerald-600/20 text-emerald-400 text-sm">{toast}</div>
      )}
      {error && (
        <div className="mb-3 p-2 rounded bg-red-600/20 text-red-400 text-sm">⚠️ {error}</div>
      )}

      {loading ? (
        <div className="opacity-70">Chargement...</div>
      ) : calls.length === 0 ? (
        <div className="opacity-70 p-6 text-center border rounded" style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.1))' }}>
          Aucun appel pour cette période. Cliquez sur <strong>Refresh</strong> pour synchroniser depuis Ringover.
        </div>
      ) : (
        <div>
          {calls.map((c) => (
            <CallRow
              key={c.cdr_id}
              call={c}
              onTranscribed={handleTranscribed}
              onCreateAffaire={handleCreateAffaire}
            />
          ))}
        </div>
      )}

      <CreateAffaireModal
        cdr_id={modalCdrId}
        onClose={() => setModalCdrId(null)}
        onCreated={() => {
          setModalCdrId(null)
          setToast('✅ Affaire créée')
          window.setTimeout(() => setToast(null), 3000)
          load()
        }}
      />
    </div>
  )
}
