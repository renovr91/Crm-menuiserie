import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { envoyerTelegram, messageSignature } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Webhook DocuSeal — notification instantanée à la signature.
 *
 * Route PUBLIQUE (appelée par DocuSeal), donc protégée par un secret partagé :
 * l'URL configurée chez DocuSeal doit porter ?token=<DOCUSEAL_WEBHOOK_SECRET>.
 * Sans secret configuré côté serveur, on refuse tout (fail closed).
 *
 * Ce endpoint n'écrit QUE dans notre base — il ne rappelle jamais l'API DocuSeal
 * et ne peut donc ni envoyer ni supprimer de demande de signature.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET || ''
  const fourni = request.nextUrl.searchParams.get('token') || request.headers.get('x-webhook-token') || ''
  if (!secret || fourni !== secret) {
    return NextResponse.json({ error: 'non autorisé' }, { status: 401 })
  }

  let corps: Record<string, unknown>
  try {
    corps = await request.json()
  } catch {
    return NextResponse.json({ error: 'corps illisible' }, { status: 400 })
  }

  const evenement = String(corps.event_type || corps.event || '')
  const data = (corps.data || {}) as Record<string, unknown>
  const submission = (data.submission || {}) as Record<string, unknown>

  // Identifiants : le payload varie selon que l'événement porte sur le
  // signataire ou sur la submission — on cherche aux deux endroits.
  const submissionId = Number(data.submission_id ?? submission.id ?? data.id ?? 0)
  const nom = String(submission.name ?? data.name ?? data.template_name ?? '')
  const titre = String(submission.name ?? (data.template as Record<string, unknown>)?.name ?? nom ?? '')
  const numero = (/DC-\d+/i.exec(titre || nom || '') || [])[0]?.toUpperCase() || null

  // On ne notifie qu'à la signature effective.
  const estSigne =
    evenement.includes('completed') ||
    !!data.completed_at ||
    submission.status === 'completed'
  if (!estSigne) {
    return NextResponse.json({ ok: true, ignore: evenement || 'evenement non pertinent' })
  }

  const supabase = createAdminClient()

  // Anti-doublon : DocuSeal peut rejouer un webhook.
  if (submissionId) {
    const { data: deja } = await supabase
      .from('devis_signatures')
      .select('notifie_at')
      .eq('submission_id', submissionId)
      .maybeSingle()
    if (deja?.notifie_at) {
      return NextResponse.json({ ok: true, deja_notifie: true })
    }
  }

  // Montant depuis le devis (si rattachable)
  let montant: number | null = null
  let clientNom: string | null = (data.name as string) || null
  if (numero) {
    const { data: devis } = await supabase
      .from('devis_claudus')
      .select('montant_ttc, client_nom')
      .eq('numero', numero)
      .maybeSingle()
    if (devis) {
      montant = devis.montant_ttc != null ? Number(devis.montant_ttc) : null
      clientNom = clientNom || devis.client_nom || null
    }
  }

  const envoye = await envoyerTelegram(
    messageSignature({ numero, client: clientNom, montant, titre: numero ? null : titre }),
  )

  if (submissionId) {
    await supabase.from('devis_signatures').upsert(
      {
        submission_id: submissionId,
        numero,
        client_nom: clientNom,
        montant_ttc: montant,
        statut: 'signe',
        signed_at: (data.completed_at as string) || new Date().toISOString(),
        notifie_at: envoye ? new Date().toISOString() : null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'submission_id' },
    )
  }

  return NextResponse.json({ ok: true, numero, telegram: envoye })
}
