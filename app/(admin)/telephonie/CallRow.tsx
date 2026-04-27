'use client'

import { useState } from 'react'
import type { RingoverCallWithTranscript, TranscribeApiResponse } from './types'

interface Props {
  call: RingoverCallWithTranscript
  onTranscribed: (cdr_id: number, data: TranscribeApiResponse) => void
  onCreateAffaire: (cdr_id: number) => void
}

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '-'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`
}

export default function CallRow({ call, onTranscribed, onCreateAffaire }: Props) {
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const date = new Date(call.start_time)
  const dateStr = date.toLocaleDateString('fr-FR')
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const durStr = formatDuration(call.incall_duration ?? call.total_duration)

  const directionIcon = call.direction === 'in' ? '📞➡️' : '➡️📞'
  const stateIcon = call.is_answered ? '✅' : '❌'
  const contactDisplay = call.contact_number || (call.direction === 'in' ? call.from_number : call.to_number)

  async function handleTranscribe() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/ringover/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdr_id: call.cdr_id }),
      })
      const data = (await r.json()) as TranscribeApiResponse | { error: string }
      if (!r.ok || 'error' in data) {
        const msg = 'error' in data ? data.error : 'Transcribe failed'
        throw new Error(msg)
      }
      onTranscribed(call.cdr_id, data)
      setExpanded(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="border rounded-lg p-3 mb-2"
      style={{
        background: 'var(--surface-1, rgba(255,255,255,0.03))',
        borderColor: 'var(--border-default, rgba(255,255,255,0.08))',
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span title={call.direction === 'in' ? 'Appel entrant' : 'Appel sortant'}>{directionIcon}</span>
            <span title={call.is_answered ? 'Répondu' : 'Manqué'}>{stateIcon}</span>
            <span className="font-semibold truncate">{contactDisplay || '?'}</span>
            <span className="opacity-60 text-xs">{dateStr} {timeStr}</span>
            <span className="opacity-50 text-xs">{durStr}</span>
            {call.ringover_user_email && (
              <span className="opacity-50 text-xs hidden md:inline">· {call.ringover_user_email}</span>
            )}
          </div>
          {call.transcript?.summary && (
            <div className="text-sm opacity-80 mt-1 line-clamp-2">{call.transcript.summary}</div>
          )}
          {error && <div className="text-xs text-red-500 mt-1">{error}</div>}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {call.record_url && (
            <audio controls src={call.record_url} className="h-8" preload="none" />
          )}
          {!call.transcript && call.record_url && (
            <button
              type="button"
              onClick={handleTranscribe}
              disabled={loading}
              className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {loading ? '⏳ Transcription...' : '🎤 Résumer'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onCreateAffaire(call.cdr_id)}
            className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            📋 Créer affaire
          </button>
          {call.transcript && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-xs opacity-70 hover:opacity-100 underline"
            >
              {expanded ? 'Cacher' : 'Détails'}
            </button>
          )}
        </div>
      </div>

      {expanded && call.transcript && (
        <div className="mt-3 pt-3 border-t text-sm" style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.08))' }}>
          {call.transcript.transcript_text && (
            <>
              <div className="font-semibold mb-1">Transcription</div>
              <div className="whitespace-pre-wrap opacity-80 text-xs max-h-48 overflow-y-auto">
                {call.transcript.transcript_text}
              </div>
            </>
          )}
          {call.transcript.extracted && (
            <>
              <div className="font-semibold mt-3 mb-1">Infos extraites</div>
              <pre
                className="text-xs p-2 rounded overflow-x-auto"
                style={{ background: 'rgba(0,0,0,0.2)' }}
              >
                {JSON.stringify(call.transcript.extracted, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
