import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// ============================================================================
//  Purge des ENREGISTREMENTS et TRANSCRIPTIONS d'appels de plus de 6 mois.
//
//  POURQUOI : enregistrer un appel client est un traitement de données
//  personnelles. La conservation doit être limitée à ce qui est nécessaire, et
//  6 mois est la durée admise pour un usage de formation ou de preuve
//  commerciale. Au-delà, la conservation devient un manquement — et elle est
//  d'autant plus visible qu'elle est automatique et datée.
//
//  CE QU'ON EFFACE : l'enregistrement et sa transcription, c'est-à-dire le
//  CONTENU de la conversation.
//  CE QU'ON GARDE : la trace de l'appel — date, durée, numéro, sens, client
//  rattaché. C'est un registre d'activité commerciale ordinaire, utile au suivi,
//  et sans le contenu il ne dit rien d'intime.
//
//  Installé le 27/08/2026, alors qu'il n'y a encore RIEN à purger (le plus
//  ancien appel date du 07/07/2026). C'est délibéré : la première échéance
//  tombe en janvier 2027, et un mécanisme qu'on découvre le jour où il doit
//  agir est un mécanisme qu'on n'a jamais vu fonctionner.
// ============================================================================

const MOIS_CONSERVATION = 6

export async function GET() {
  const sb = createAdminClient()
  const limite = new Date()
  limite.setMonth(limite.getMonth() - MOIS_CONSERVATION)

  // On lit d'abord pour pouvoir DIRE ce qui a été effacé. Un effacement muet
  // est indistinguable d'un effacement qui n'a pas eu lieu.
  const { data: concernes, error: eLecture } = await sb
    .from('calls')
    .select('id, started_at')
    .lt('started_at', limite.toISOString())
    .or('recording_url.not.is.null,transcript.not.is.null')
    .limit(1000)

  if (eLecture) {
    return NextResponse.json({ error: eLecture.message }, { status: 500 })
  }
  if (!concernes || concernes.length === 0) {
    return NextResponse.json({
      ok: true,
      purges: 0,
      limite: limite.toISOString().slice(0, 10),
      message: 'Aucun enregistrement au-delà de la durée de conservation.',
    })
  }

  const { error } = await sb
    .from('calls')
    .update({ recording_url: null, transcript: null })
    .in('id', concernes.map((c) => c.id))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const dates = concernes.map((c) => c.started_at).sort()
  console.warn(
    `[purge appels] ${concernes.length} enregistrement(s) effacé(s), du ${dates[0]} au ${dates[dates.length - 1]}`,
  )

  return NextResponse.json({
    ok: true,
    purges: concernes.length,
    limite: limite.toISOString().slice(0, 10),
    plus_ancien: dates[0],
    plus_recent: dates[dates.length - 1],
    conserve: 'date, durée, numéro et client restent ; seul le contenu est effacé',
  })
}
