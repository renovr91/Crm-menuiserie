/**
 * /api/ringover/to-affaire
 *
 * GET ?cdr_id=…
 *   Match the call against an existing client (by phone), an LBC lead, and the
 *   commercial owning the Ringover user. Returns suggested fields for the modal.
 *
 * POST { cdr_id, mode, client_data, affaire_data }
 *   Create / link client + affaire + activité, depending on `mode`:
 *     - "existing"  → use client_data.id (existing client), best-effort fill missing fields
 *     - "from_lead" → create client from extracted data, link the lbc_leads row
 *     - "new"       → create fresh client
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { normalizePhone } from '@/lib/ringover'
import { parseAmount, type ExtractedData } from '@/lib/mistral'

interface CallRow {
  cdr_id: number
  direction: 'in' | 'out'
  from_number: string
  to_number: string
  contact_number: string | null
  start_time: string
  ringover_user_email: string | null
  is_answered: boolean
}

interface TranscriptRow {
  cdr_id: number
  transcript_text: string | null
  summary: string | null
  extracted: Partial<ExtractedData> | null
}

interface ClientRow {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  ville: string | null
  code_postal: string | null
  adresse: string | null
  source: string | null
}

interface LeadRow {
  id: string
  contact_name: string
  telephone: string | null
  email: string | null
  city: string | null
  zip_code: string | null
  ad_title: string | null
}

interface CommercialRow {
  id: string
  nom: string
  email: string | null
}

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const cdr_id = sp.get('cdr_id')
    if (!cdr_id) return NextResponse.json({ error: 'cdr_id required' }, { status: 400 })

    const sb = createAdminClient()

    const { data: call } = await sb
      .from('ringover_calls')
      .select('*')
      .eq('cdr_id', cdr_id)
      .maybeSingle()
    if (!call) return NextResponse.json({ error: 'call not found' }, { status: 404 })
    const c = call as CallRow

    const { data: tr } = await sb
      .from('call_transcripts')
      .select('*')
      .eq('cdr_id', cdr_id)
      .maybeSingle()
    const transcript = (tr as TranscriptRow | null) || null
    const extracted: Partial<ExtractedData> = transcript?.extracted || {}

    // Numéro à rechercher selon direction
    const contactRaw = c.direction === 'in' ? c.from_number : c.to_number
    const contactNorm = normalizePhone(contactRaw)

    // 1) Match client via téléphone
    let mode: 'new' | 'existing' | 'from_lead' | 'ambiguous' = 'new'
    let client: ClientRow | ClientRow[] | null = null
    let lead: LeadRow | null = null

    if (contactNorm) {
      const filter =
        contactRaw && contactRaw !== contactNorm
          ? `telephone.eq.${contactNorm},telephone.eq.${contactRaw}`
          : `telephone.eq.${contactNorm}`
      const { data: clients } = await sb.from('clients').select('*').or(filter).limit(2)
      const list = (clients || []) as ClientRow[]
      if (list.length === 1) {
        mode = 'existing'
        client = list[0]
      } else if (list.length > 1) {
        mode = 'ambiguous'
        client = list
      }
    }

    // 2) Si pas de client matché → cherche un LBC lead
    if (mode === 'new' && contactNorm) {
      const filter =
        contactRaw && contactRaw !== contactNorm
          ? `telephone.eq.${contactNorm},telephone.eq.${contactRaw}`
          : `telephone.eq.${contactNorm}`
      const { data: leads } = await sb.from('lbc_leads').select('*').or(filter).limit(1)
      const list = (leads || []) as LeadRow[]
      if (list.length > 0) {
        mode = 'from_lead'
        lead = list[0]
      }
    }

    // 3) Match commercial via ringover_user_email
    let commercial: CommercialRow | null = null
    if (c.ringover_user_email) {
      const { data } = await sb
        .from('commerciaux')
        .select('id, nom, email')
        .eq('email', c.ringover_user_email)
        .maybeSingle()
      if (data) commercial = data as CommercialRow
    }

    // 4) Suggested values
    const date = new Date(c.start_time)
    const dateStr = date.toLocaleDateString('fr-FR')
    const productLabel = extracted.product_type || 'téléphonique'
    const titreSuggested = `Appel ${dateStr} - ${productLabel}`

    const singleClient = !Array.isArray(client) ? client : null

    return NextResponse.json({
      mode,
      call: c,
      transcript,
      client,
      lead,
      commercial,
      suggested: {
        nom: extracted.name || lead?.contact_name || singleClient?.nom || '',
        telephone: contactNorm,
        email: extracted.email || lead?.email || singleClient?.email || '',
        ville: extracted.city || lead?.city || singleClient?.ville || '',
        code_postal: extracted.zip_code || lead?.zip_code || singleClient?.code_postal || '',
        adresse: singleClient?.adresse || '',
        titre: titreSuggested,
        description: transcript?.summary || '',
        besoin: extracted.product_type || '',
        montant_estime: parseAmount(extracted.estimated_amount ?? null),
        pipeline_stage: 'nouveau',
        commercial_id: commercial?.id || null,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[to-affaire/GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface PostBody {
  cdr_id: number
  mode: 'existing' | 'from_lead' | 'new'
  client_data: {
    id?: string
    lead_id?: string
    nom: string
    telephone?: string | null
    email?: string | null
    ville?: string | null
    code_postal?: string | null
    adresse?: string | null
  }
  affaire_data: {
    titre: string
    description?: string | null
    pipeline_stage?: string
    montant_estime?: number
    commercial_id?: string | null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody
    const { cdr_id, mode, client_data, affaire_data } = body
    if (!cdr_id || !mode) {
      return NextResponse.json({ error: 'cdr_id and mode required' }, { status: 400 })
    }
    if (!client_data?.nom || !affaire_data?.titre) {
      return NextResponse.json({ error: 'client_data.nom and affaire_data.titre required' }, { status: 400 })
    }

    const sb = createAdminClient()

    const { data: call } = await sb
      .from('ringover_calls')
      .select('*')
      .eq('cdr_id', cdr_id)
      .maybeSingle()
    if (!call) return NextResponse.json({ error: 'call not found' }, { status: 404 })
    const c = call as CallRow

    let client_id: string

    // 1) Gérer le client selon le mode
    if (mode === 'existing') {
      if (!client_data.id) {
        return NextResponse.json({ error: 'client_data.id required for mode=existing' }, { status: 400 })
      }
      client_id = client_data.id
      // Best-effort : remplir les champs vides côté CRM
      const updates: Record<string, string> = {}
      if (client_data.email) updates.email = client_data.email
      if (client_data.ville) updates.ville = client_data.ville
      if (client_data.code_postal) updates.code_postal = client_data.code_postal
      if (client_data.adresse) updates.adresse = client_data.adresse
      if (Object.keys(updates).length > 0) {
        await sb.from('clients').update(updates).eq('id', client_id)
      }
    } else if (mode === 'from_lead' || mode === 'new') {
      const phone = client_data.telephone ? client_data.telephone.replace(/\s/g, '') : null
      const { data: newClient, error } = await sb
        .from('clients')
        .insert({
          nom: client_data.nom,
          telephone: phone,
          email: client_data.email || null,
          ville: client_data.ville || null,
          code_postal: client_data.code_postal || null,
          adresse: client_data.adresse || null,
          source: mode === 'from_lead' ? 'lbc_ringover' : 'ringover',
        })
        .select()
        .single()
      if (error) throw new Error(`Insert client: ${error.message}`)
      client_id = newClient.id

      // Lier le lead si fourni
      if (mode === 'from_lead' && client_data.lead_id) {
        const { error: linkErr } = await sb
          .from('lbc_leads')
          .update({ client_id })
          .eq('id', client_data.lead_id)
        if (linkErr) console.warn('[to-affaire] lead link failed:', linkErr.message)
      }
    } else {
      return NextResponse.json({ error: 'invalid mode' }, { status: 400 })
    }

    // 2) Créer l'affaire
    const { data: affaire, error: affErr } = await sb
      .from('affaires')
      .insert({
        client_id,
        titre: affaire_data.titre,
        description: affaire_data.description || null,
        pipeline_stage: affaire_data.pipeline_stage || 'nouveau',
        montant_estime: affaire_data.montant_estime || 0,
        commercial_id: affaire_data.commercial_id || null,
      })
      .select()
      .single()
    if (affErr) throw new Error(`Insert affaire: ${affErr.message}`)

    // 3) Créer une activité d'appel (déjà fait, lié au moment de l'appel)
    const directionLabel = c.direction === 'in' ? 'entrant' : 'sortant'
    const stateLabel = c.is_answered ? '' : ' (manqué)'
    const contenu = affaire_data.description
      ? `[Appel ${directionLabel}${stateLabel}] ${affaire_data.description}`
      : `Appel ${directionLabel}${stateLabel} - ${c.contact_number || ''}`

    const { error: actErr } = await sb.from('activites').insert({
      client_id,
      commercial_id: affaire_data.commercial_id || null,
      type: 'appel',
      contenu,
      date_faite: c.start_time,
      fait: true,
    })
    if (actErr) console.warn('[to-affaire] activite insert failed:', actErr.message)

    return NextResponse.json({ affaire_id: affaire.id, client_id })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[to-affaire/POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
