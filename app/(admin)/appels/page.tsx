'use client'

import { useState, useEffect, useCallback } from 'react'

interface Extracted {
  name?: string | null
  city?: string | null
  zip_code?: string | null
  phone?: string | null
  email?: string | null
  product_type?: string | null
  quantity?: number | null
  estimated_amount?: string | null
  urgency?: string | null
  next_action?: string | null
}

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
  extracted: Extracted | null
  status: string
  audio: string | null
  clients: { nom: string } | null
}

// Rend une transcription "Client: ... / Renov-R: ..." en bulles colorées
function Transcript({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim())
  const hasSpeakers = lines.some((l) => /^(Client|Renov-R)\s*:/i.test(l))
  if (!hasSpeakers) {
    return <div className="text-sm text-gray-600 whitespace-pre-wrap">{text}</div>
  }
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const m = line.match(/^(Client|Renov-R)\s*:\s*(.*)$/i)
        const who = m ? m[1] : ''
        const body = m ? m[2] : line
        const isClient = /client/i.test(who)
        return (
          <div key={i} className={`flex ${isClient ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                isClient ? 'bg-white border border-gray-200 text-gray-800' : 'bg-blue-600 text-white'
              }`}
            >
              <div className={`text-[10px] font-semibold mb-0.5 ${isClient ? 'text-gray-400' : 'text-blue-100'}`}>
                {who || '—'}
              </div>
              {body}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Fiche client extraite par l'IA (à vérifier)
function FicheClient({ e }: { e: Extracted }) {
  const rows = (
    [
      ['Nom', e.name],
      ['Email', e.email],
      ['Téléphone', e.phone],
      ['Ville', e.city],
      ['Code postal', e.zip_code],
      ['Produit', e.product_type],
      ['Quantité', e.quantity],
      ['Montant estimé', e.estimated_amount],
      ['Urgence', e.urgency],
      ['Prochaine action', e.next_action],
    ] as [string, string | number | null | undefined][]
  ).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!rows.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-amber-800 uppercase mb-2">
        Fiche client (IA — à vérifier)
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <span className="text-gray-500">{k} :</span>
            <span className="text-gray-900 font-medium">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
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
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')

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

  const nbIn = calls.filter((c) => c.direction === 'in').length
  const nbOut = calls.filter((c) => c.direction === 'out').length
  const shown = filter === 'all' ? calls : calls.filter((c) => c.direction === filter)

  const tabs: { key: 'all' | 'in' | 'out'; label: string }[] = [
    { key: 'all', label: `Tous (${calls.length})` },
    { key: 'in', label: `📥 Reçus (${nbIn})` },
    { key: 'out', label: `📤 Émis (${nbOut})` },
  ]

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

      {/* Filtre Reçus / Émis */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filter === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && calls.length === 0 ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun appel dans cette catégorie.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((c) => (
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
                  {c.extracted && <FicheClient e={c.extracted} />}
                  {c.transcript && (
                    <details>
                      <summary className="text-xs font-semibold text-gray-700 uppercase cursor-pointer">
                        Transcription (Client / Renov-R)
                      </summary>
                      <div className="mt-2">
                        <Transcript text={c.transcript} />
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
