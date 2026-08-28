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

  // ============================================================
  // OUVERTURE DU DOSSIER CLIENT — la signature est le coup d'envoi.
  // Deux effets, ni l'un ni l'autre ne doit dépendre d'une saisie :
  //  1. le CLIENT entre dans la base (s'il n'y est pas déjà) ;
  //  2. un DOSSIER s'ouvre en « signé, attente règlement » — c'est lui
  //     que le brief du matin surveillera jusqu'à la livraison.
  // Best-effort : un échec ici ne doit pas faire rejouer le webhook
  // (DocuSeal renverrait l'événement et dupliquerait la notification).
  // ============================================================
  if (numero) {
    try {
      const { data: devisComplet } = await supabase
        .from('devis_claudus')
        .select('client_nom, client_telephone, client_email, client_adresse, client_cp, client_ville, reference, montant_ttc')
        .eq('numero', numero)
        .maybeSingle()

      // L'adresse des devis est souvent TASSÉE dans le champ ville
      // (« 333 Camin Dou Camp De Cesar, 30330 Saint-Paul-les-Fonts ») : les
      // anciens outils ne séparaient pas. On découpe au code postal — motif
      // fiable à 5 chiffres — plutôt que de créer des fiches client vides.
      let adr = (devisComplet?.client_adresse || '').trim()
      let cp = (devisComplet?.client_cp || '').trim()
      let ville = (devisComplet?.client_ville || '').trim()
      if (!adr && !cp && ville) {
        const m = ville.match(/^(.*?),?\s*(\d{5})\s+(.+)$/)
        if (m) { adr = m[1].replace(/,\s*$/, '').trim(); cp = m[2]; ville = m[3].trim() }
      }

      let clientId: string | null = null
      if (devisComplet?.client_nom) {
        // Retrouver le client par téléphone d'abord (le plus discriminant),
        // sinon par nom exact ; créer à défaut.
        const tel = (devisComplet.client_telephone || '').replace(/\s/g, '')
        let existant = null
        if (tel) {
          const { data } = await supabase.from('clients').select('id').eq('telephone', tel).maybeSingle()
          existant = data
        }
        if (!existant) {
          const { data } = await supabase.from('clients').select('id').eq('nom', devisComplet.client_nom).maybeSingle()
          existant = data
        }
        if (existant) {
          clientId = existant.id
          // Compléter sans écraser : le devis signé est une source fiable pour
          // les champs encore vides — jamais pour ceux déjà renseignés à la main.
          const { data: fiche } = await supabase
            .from('clients')
            .select('adresse, code_postal, ville, email, montant_estime, pipeline_stage')
            .eq('id', clientId).maybeSingle()
          const complement: Record<string, unknown> = {}
          if (fiche && !fiche.adresse && adr) complement.adresse = adr
          if (fiche && !fiche.code_postal && cp) complement.code_postal = cp
          if (fiche && !fiche.ville && ville) complement.ville = ville
          if (fiche && !fiche.email && devisComplet.client_email) complement.email = devisComplet.client_email
          if (fiche && fiche.montant_estime == null && devisComplet.montant_ttc != null)
            complement.montant_estime = Number(devisComplet.montant_ttc)
          if (fiche && fiche.pipeline_stage !== 'signe') complement.pipeline_stage = 'signe'
          if (Object.keys(complement).length) {
            await supabase.from('clients').update(complement).eq('id', clientId)
          }
        }
        else {
          const { data: cree } = await supabase
            .from('clients')
            .insert({
              nom: devisComplet.client_nom,
              telephone: tel || null,
              email: devisComplet.client_email || null,
              adresse: adr || null,
              code_postal: cp || null,
              ville: ville || null,
              source: 'signature devis',
              // Un client qui vient de SIGNER n'est pas un « nouveau » prospect.
              pipeline_stage: 'signe',
              besoin: devisComplet.reference || null,
              montant_estime: devisComplet.montant_ttc != null ? Number(devisComplet.montant_ttc) : null,
            })
            .select('id')
            .maybeSingle()
          clientId = cree?.id || null
        }
      }

      await supabase.from('commandes').upsert(
        {
          devis_numero: numero,
          client_id: clientId,
          designation: devisComplet?.reference || `Devis ${numero}`,
          montant_ttc: devisComplet?.montant_ttc != null ? Number(devisComplet.montant_ttc) : montant,
          stage: 'signe',
          // `status` est la colonne HISTORIQUE (check en_attente/commandee/…)
          // encore lue par l'ancienne page : on la maintient en miroir du stage.
          status: 'en_attente',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'devis_numero', ignoreDuplicates: true },
      )
    } catch (e) {
      console.error('[docuseal webhook] ouverture dossier', numero, e)
    }
  }

  return NextResponse.json({ ok: true, numero, telegram: envoye })
}
