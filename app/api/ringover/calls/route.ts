/**
 * GET /api/ringover/calls
 * List calls from the Supabase cache, joined with their transcripts.
 *
 * Query params:
 *   period:    today | week | month | all       (default: week)
 *   direction: in | out | <omit for all>
 *   missed:    "true" to keep only unanswered calls
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

interface TranscriptRow {
  cdr_id: number
  transcript_text: string | null
  summary: string | null
  extracted: Record<string, unknown> | null
  audio_duration_s: number | null
  voxtral_model: string | null
  summary_model: string | null
  created_at: string | null
}

interface CallRow {
  cdr_id: number
  transcript: TranscriptRow[] | TranscriptRow | null
  [key: string]: unknown
}

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const period = sp.get('period') || 'week'
    const direction = sp.get('direction')
    const missedOnly = sp.get('missed') === 'true'

    const sb = createAdminClient()
    let q = sb
      .from('ringover_calls')
      .select('*, transcript:call_transcripts(*)')
      .order('start_time', { ascending: false })
      .limit(200)

    if (period === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      q = q.gte('start_time', start.toISOString())
    } else if (period === 'week') {
      const start = new Date()
      start.setDate(start.getDate() - 7)
      q = q.gte('start_time', start.toISOString())
    } else if (period === 'month') {
      const start = new Date()
      start.setMonth(start.getMonth() - 1)
      q = q.gte('start_time', start.toISOString())
    }

    if (direction === 'in' || direction === 'out') q = q.eq('direction', direction)
    if (missedOnly) q = q.eq('is_answered', false)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    // PostgREST renvoie la relation 1:1 sous forme de tableau → flatten
    const calls = ((data || []) as CallRow[]).map((c) => ({
      ...c,
      transcript: Array.isArray(c.transcript) ? c.transcript[0] || null : c.transcript,
    }))

    return NextResponse.json({ calls })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[ringover/calls]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
