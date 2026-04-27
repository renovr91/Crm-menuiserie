/**
 * POST /api/ringover/transcribe
 * Body: { cdr_id: number }
 * 1. Cache check (call_transcripts)
 * 2. Download audio from Ringover
 * 3. Transcribe with Voxtral
 * 4. Summarize + extract with Mistral Small
 * 5. Persist in call_transcripts
 */
import { NextRequest, NextResponse } from 'next/server'
import { downloadRecord } from '@/lib/ringover'
import { transcribeAudio, summarizeAndExtract } from '@/lib/mistral'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const cdr_id = body?.cdr_id
    if (!cdr_id) return NextResponse.json({ error: 'cdr_id required' }, { status: 400 })

    const sb = createAdminClient()

    // 1. Cache check
    const { data: existing } = await sb
      .from('call_transcripts')
      .select('*')
      .eq('cdr_id', cdr_id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({
        transcript: existing.transcript_text,
        summary: existing.summary,
        extracted: existing.extracted,
        cached: true,
      })
    }

    // 2. Get call info
    const { data: call, error: callErr } = await sb
      .from('ringover_calls')
      .select('*')
      .eq('cdr_id', cdr_id)
      .maybeSingle()
    if (callErr) throw new Error(`Supabase select call: ${callErr.message}`)
    if (!call) return NextResponse.json({ error: 'call not found' }, { status: 404 })
    if (!call.record_url) {
      return NextResponse.json({ error: 'no recording for this call' }, { status: 400 })
    }

    // 3. Download audio
    const audio = await downloadRecord(call.record_url)
    if (!audio || audio.length === 0) {
      return NextResponse.json({ error: 'empty audio file' }, { status: 502 })
    }

    // 4. Transcribe (Voxtral)
    const transcript = await transcribeAudio(audio, `call-${cdr_id}.mp3`)

    // 5. Summarize + extract (Mistral Small)
    const summary = await summarizeAndExtract(transcript.text)

    // 6. Save in cache (best-effort)
    const { error: upErr } = await sb.from('call_transcripts').insert({
      cdr_id,
      transcript_text: transcript.text,
      summary: summary.summary,
      extracted: summary.extracted,
      audio_duration_s: transcript.duration_s,
      voxtral_model: transcript.model,
      summary_model: summary.model,
    })
    if (upErr) console.warn('[transcribe] cache insert failed:', upErr.message)

    return NextResponse.json({
      transcript: transcript.text,
      summary: summary.summary,
      extracted: summary.extracted,
      cached: false,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[ringover/transcribe]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
