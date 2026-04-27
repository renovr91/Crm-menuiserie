/**
 * POST /api/ringover/sync
 * Fetch latest calls from Ringover API and upsert into ringover_calls.
 *
 * Body (optional): { limit?: number, since?: string }
 * Returns: { synced: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { listCalls } from '@/lib/ringover'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const limit = typeof body.limit === 'number' ? body.limit : 100
    const since = typeof body.since === 'string' ? body.since : undefined

    const calls = await listCalls({ limit, since })

    const rows = calls.map((c) => ({
      cdr_id: c.cdr_id,
      call_id: c.call_id,
      direction: c.direction,
      type: c.type,
      last_state: c.last_state,
      is_answered: c.is_answered,
      start_time: c.start_time,
      answered_time: c.answered_time,
      end_time: c.end_time,
      total_duration: c.total_duration,
      incall_duration: c.incall_duration,
      from_number: c.from_number,
      to_number: c.to_number,
      contact_number: c.contact_number,
      record_url: c.record,
      ringover_user_id: c.user?.user_id ?? null,
      ringover_user_email: c.user?.email ?? null,
      raw: c,
      synced_at: new Date().toISOString(),
    }))

    if (rows.length === 0) {
      return NextResponse.json({ synced: 0 })
    }

    const sb = createAdminClient()
    const { error } = await sb.from('ringover_calls').upsert(rows, { onConflict: 'cdr_id' })
    if (error) throw new Error(`Supabase upsert: ${error.message}`)

    return NextResponse.json({ synced: rows.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[ringover/sync]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
