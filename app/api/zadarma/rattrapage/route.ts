import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getRecordingLink } from '@/lib/zadarma'
import { transcribeAudio, summarizeAndExtract } from '@/lib/mistral'

export const maxDuration = 60

// ============================================================================
//  RATTRAPAGE des enregistrements d'appels.
//
//  POURQUOI : 59 appels « enregistrés » sans audio ni transcription, statut
//  new, aucune erreur (constat du 28/08/2026). L'événement NOTIFY_RECORD de
//  Zadarma n'atteint pas toujours le webhook — ou arrive avant que la ligne
//  d'appel existe, et la mise à jour ne trouve rien. Le webhook reste le chemin
//  rapide ; ce rattrapage horaire est le filet : ce qui lui a échappé est
//  retenté, et ce qui échoue VRAIMENT porte enfin une erreur lisible au lieu
//  d'un « new » éternel.
//
//  Même traitement exactement que le webhook (lien → audio → transcription →
//  résumé) — dupliqué faute de lib commune historique, à garder aligné.
// ============================================================================

async function traiter(pbxCallId: string, recId: string) {
  const supabase = createAdminClient()
  try {
    const link = await getRecordingLink(recId)
    if (!link) throw new Error('pas de lien enregistrement')
    const audioResp = await fetch(link)
    if (!audioResp.ok) throw new Error(`download ${audioResp.status}`)
    const audio = Buffer.from(await audioResp.arrayBuffer())

    const path = `${pbxCallId}.mp3`
    await supabase.storage.from('recordings').upload(path, audio, { contentType: 'audio/mpeg', upsert: true })

    const tr = await transcribeAudio(audio, path)
    const source = tr.diarized || tr.text
    let transcript = source
    let summary = ''
    let extracted: unknown = null
    if (source) {
      const a = await summarizeAndExtract(source)
      summary = a.summary
      extracted = a.extracted
      if (tr.segments.length && a.client_speaker) {
        transcript = tr.segments
          .map((g) => `${g.speaker === a.client_speaker ? 'Client' : 'Renov-R'}: ${g.text}`)
          .join('\n')
      }
    }
    await supabase.from('calls')
      .update({ recording_url: path, transcript, summary, extracted, status: 'done', error: null })
      .eq('pbx_call_id', pbxCallId)
    return true
  } catch (e) {
    await supabase.from('calls')
      .update({ status: 'error', error: `rattrapage: ${String(e).slice(0, 200)}` })
      .eq('pbx_call_id', pbxCallId)
    return false
  }
}

export async function GET() {
  const sb = createAdminClient()
  // Les oubliés : marqués enregistrés, sans audio, pas déjà en erreur, âgés
  // d'au moins 10 minutes (le temps que Zadarma finalise) et d'au plus 7 jours
  // (au-delà, l'enregistrement n'est souvent plus téléchargeable).
  const { data: oublies, error } = await sb
    .from('calls')
    .select('pbx_call_id, call_id_with_rec, started_at')
    .eq('is_recorded', true)
    .is('recording_url', null)
    .in('status', ['new', 'processing'])
    .gte('started_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .lte('started_at', new Date(Date.now() - 10 * 60000).toISOString())
    .order('started_at', { ascending: false })
    .limit(6) // borné : transcription ~3-8 s pièce, la fonction a 60 s
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!oublies?.length) return NextResponse.json({ ok: true, traites: 0 })

  let ok = 0
  for (const c of oublies) {
    if (await traiter(c.pbx_call_id, c.call_id_with_rec || c.pbx_call_id)) ok++
  }
  return NextResponse.json({ ok: true, candidats: oublies.length, reussis: ok })
}
