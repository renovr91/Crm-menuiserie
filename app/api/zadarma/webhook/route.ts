import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getRecordingLink, verifyWebhookSignature, parseZadarmaDate } from '@/lib/zadarma'
import { transcribeAudio, summarizeAndExtract } from '@/lib/mistral'

export const maxDuration = 60

// Normalise un numéro FR pour le matching (+33612... -> 0612...)
function normalizePhone(n?: string): string {
  if (!n) return ''
  let s = n.replace(/[^\d+]/g, '')
  if (s.startsWith('+33')) s = '0' + s.slice(3)
  else if (s.startsWith('33') && s.length === 11) s = '0' + s.slice(2)
  return s
}

async function matchClient(supabase: ReturnType<typeof createAdminClient>, phone: string) {
  const p = normalizePhone(phone)
  if (!p) return null
  const { data } = await supabase
    .from('clients')
    .select('id, telephone')
    .not('telephone', 'is', null)
  if (!data) return null
  const hit = data.find((c) => normalizePhone(c.telephone || '') === p)
  return hit?.id || null
}

// GET : vérification de l'URL par Zadarma (echo)
export async function GET(req: NextRequest) {
  const echo = req.nextUrl.searchParams.get('zd_echo')
  if (echo) return new NextResponse(echo, { status: 200 })
  return NextResponse.json({ ok: true })
}

// POST : événements d'appel
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const params = Object.fromEntries(new URLSearchParams(raw))
  const event = params.event || ''

  // Vérif signature (non bloquante tant que ZADARMA_WEBHOOK_STRICT != 'true')
  const validSig = verifyWebhookSignature(raw, req.headers.get('signature'))
  if (process.env.ZADARMA_WEBHOOK_STRICT === 'true' && !validSig) {
    return NextResponse.json({ error: 'bad signature' }, { status: 403 })
  }

  const supabase = createAdminClient()
  const pbxId = params.pbx_call_id || ''
  const isOut = event.startsWith('NOTIFY_OUT')
  const direction = event === 'NOTIFY_INTERNAL' ? 'internal' : isOut ? 'out' : 'in'

  try {
    if (event === 'NOTIFY_START' || event === 'NOTIFY_OUT_START' || event === 'NOTIFY_INTERNAL') {
      const caller = isOut ? params.internal || params.caller_id : params.caller_id
      const callee = isOut ? params.destination : params.called_did
      await supabase.from('calls').upsert(
        {
          pbx_call_id: pbxId,
          direction,
          caller,
          callee,
          extension: isOut ? params.internal : params.internal || params.destination,
          started_at: parseZadarmaDate(params.call_start),
          client_id: await matchClient(supabase, isOut ? params.destination : params.caller_id),
          status: 'new',
        },
        { onConflict: 'pbx_call_id' }
      )
    } else if (event === 'NOTIFY_END' || event === 'NOTIFY_OUT_END') {
      await supabase.from('calls').upsert(
        {
          pbx_call_id: pbxId,
          direction,
          duration: parseInt(params.duration || '0', 10),
          disposition: params.disposition || null,
          is_recorded: params.is_recorded === 'true' || !!params.call_id_with_rec,
          call_id_with_rec: params.call_id_with_rec || null,
          extension: params.internal || params.destination || null,
        },
        { onConflict: 'pbx_call_id' }
      )
    } else if (event === 'NOTIFY_RECORD') {
      const recId = params.call_id_with_rec || params.pbx_call_id
      await supabase
        .from('calls')
        .update({ is_recorded: true, call_id_with_rec: recId, status: 'processing' })
        .eq('pbx_call_id', pbxId)
      // Traitement direct (rapide : ~3s) : télécharge, transcrit, résume
      await processRecording(pbxId, recId)
    }
  } catch (e) {
    console.error('[zadarma webhook]', event, e)
  }

  return NextResponse.json({ ok: true })
}

// Télécharge l'enregistrement -> Supabase Storage -> transcription -> résumé
async function processRecording(pbxCallId: string, recId: string) {
  const supabase = createAdminClient()
  try {
    const link = await getRecordingLink(recId)
    if (!link) throw new Error('pas de lien enregistrement')

    const audioResp = await fetch(link)
    if (!audioResp.ok) throw new Error(`download ${audioResp.status}`)
    const audio = Buffer.from(await audioResp.arrayBuffer())

    const path = `${pbxCallId}.mp3`
    await supabase.storage.from('recordings').upload(path, audio, {
      contentType: 'audio/mpeg',
      upsert: true,
    })

    const tr = await transcribeAudio(audio, path)
    const source = tr.diarized || tr.text
    let transcript = source
    let summary = ''
    let extracted: unknown = null
    if (source) {
      const a = await summarizeAndExtract(source)
      summary = a.summary
      extracted = a.extracted
      // Remplace speaker_1/speaker_2 par Renov-R / Client
      if (tr.segments.length && a.client_speaker) {
        transcript = tr.segments
          .map((g) => `${g.speaker === a.client_speaker ? 'Client' : 'Renov-R'}: ${g.text}`)
          .join('\n')
      }
    }

    await supabase
      .from('calls')
      .update({ recording_url: path, transcript, summary, extracted, status: 'done', error: null })
      .eq('pbx_call_id', pbxCallId)
  } catch (e) {
    console.error('[processRecording]', pbxCallId, e)
    await supabase
      .from('calls')
      .update({ status: 'error', error: String(e) })
      .eq('pbx_call_id', pbxCallId)
  }
}
