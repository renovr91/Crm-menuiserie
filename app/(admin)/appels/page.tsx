'use client'

import { useState, useEffect, useCallback } from 'react'

interface Call {
  id: string
  direction: 'in' | 'out' | 'internal'
  caller: string | null
  callee: string | null
  extension: string | null
  started_at: string | null
  duration: number
  disposition: string | null
  is_recorded: boolean
  transcript: string | null
  summary: string | null
  status: string
  audio: string | null
  clients: { nom: string } | null
}

const dateFr = (d: string | null) =>
  d
    ? new Date(d).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

const durFr = (s: number) => {
  if (!s) return '0s'
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? `${m}m${r.toString().padStart(2, '0')}` : `${r}s`
}

const dirIcon = (d: string) => (d === 'in' ? '📥' : d === 'out' ? '📤' : '🔁')
const dirLabel = (d: string) => (d === 'in' ? 'Entrant' : d === 'out' ? 'Sortant' : 'Interne')

const dispoBadge = (d: string | null) => {
  const map: Record<string, string> = {
    answered: 'bg-green-100 text-green-700',
    'no answer': 'bg-gray-100 text-gray-600',
    busy: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
    cancel: 'bg-gray-100 text-gray-600',
  }
  return map[d || ''] || 'bg-gray-100 text-gray-600'
}

export default function AppelsPage() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/zadarma/calls', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur chargement')
      setCalls(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-2xl">📞</span> Appels
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Historique, enregistrements, transcription et résumé IA
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <span className={loading ? 'animate-spin' : ''}>🔄</span> Actualiser
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && calls.length === 0 ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun appel pour le moment.</p>
      ) : (
        <div className="space-y-2">
          {calls.map((c) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpen(open === c.id ? null : c.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="text-lg" title={dirLabel(c.direction)}>
                  {dirIcon(c.direction)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {c.clients?.nom || c.caller || c.callee || 'Inconnu'}
                    {c.clients?.nom && (
                      <span className="text-gray-400 font-normal">
                        {' '}
                        · {c.direction === 'in' ? c.caller : c.callee}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {dateFr(c.started_at)} · {durFr(c.duration)}
                    {c.extension && <> · poste {c.extension}</>}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${dispoBadge(c.disposition)}`}>
                  {c.disposition || '—'}
                </span>
                {c.is_recorded && <span title="Enregistré">🔴</span>}
              </button>

              {open === c.id && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50">
                  {c.audio && (
                    <audio controls src={c.audio} className="w-full h-9">
                      Lecteur audio non supporté
                    </audio>
                  )}
                  {c.status === 'processing' && (
                    <p className="text-xs text-blue-600">⏳ Transcription en cours…</p>
                  )}
                  {c.status === 'error' && (
                    <p className="text-xs text-red-600">Erreur de traitement.</p>
                  )}
                  {c.summary && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-700 uppercase mb-1">
                        Résumé IA
                      </h3>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap">{c.summary}</div>
                    </div>
                  )}
                  {c.transcript && (
                    <details>
                      <summary className="text-xs font-semibold text-gray-700 uppercase cursor-pointer">
                        Transcription
                      </summary>
                      <div className="text-sm text-gray-600 whitespace-pre-wrap mt-1">
                        {c.transcript}
                      </div>
                    </details>
                  )}
                  {!c.is_recorded && (
                    <p className="text-xs text-gray-400">Pas d'enregistrement pour cet appel.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
