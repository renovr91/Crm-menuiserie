import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Route de consultation pour l'agent IA (Hermes).
//
// LECTURE SEULE : aucune action ci-dessous n'écrit en base. L'agent ne peut pas
// modifier ni supprimer quoi que ce soit, même s'il était manipulé (injection de
// prompt via un mail piégé par exemple).
//
// Table otp_codes volontairement inaccessible : elle permettrait de signer un
// devis à la place d'un client.
//
// Auth : header `Authorization: Bearer <AGENT_API_TOKEN>`. La route est dans la
// liste publique du middleware (l'agent n'a pas de session navigateur), elle
// porte donc sa propre authentification.

const MAX_LIMIT = 50

function tokenValide(request: Request): boolean {
  const attendu = process.env.AGENT_API_TOKEN || ''
  if (!attendu) return false // fail-closed : pas de jeton configuré = tout refusé

  const entete = request.headers.get('authorization') || ''
  const fourni = entete.startsWith('Bearer ') ? entete.slice(7) : ''
  if (!fourni) return false

  const a = Buffer.from(fourni)
  const b = Buffer.from(attendu)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function borne(n: unknown, defaut: number): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10)
  if (!Number.isFinite(v) || v <= 0) return defaut
  return Math.min(v, MAX_LIMIT)
}

export async function POST(request: Request) {
  if (!tokenValide(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  let body: { action?: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide' }, { status: 400 })
  }

  const action = String(body.action || '')
  const p = body.params || {}
  const supabase = createAdminClient()

  try {
    switch (action) {
      // ---- Clients -------------------------------------------------------
      case 'search_clients': {
        const q = String(p.q || '').trim()
        let req = supabase
          .from('clients')
          .select('id, nom, telephone, email, ville, code_postal, source, pipeline_stage, created_at')
          .order('created_at', { ascending: false })
          .limit(borne(p.limit, 20))
        if (q) req = req.or(`nom.ilike.%${q}%,telephone.ilike.%${q}%,email.ilike.%${q}%,ville.ilike.%${q}%`)
        const { data, error } = await req
        if (error) throw error
        return NextResponse.json({ clients: data })
      }

      case 'get_client': {
        const id = String(p.id || '')
        if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

        const [client, affaires, devis, appels, taches] = await Promise.all([
          supabase.from('clients').select('*').eq('id', id).single(),
          supabase.from('affaires').select('id, titre, pipeline_stage, montant_estime, created_at').eq('client_id', id).limit(20),
          supabase.from('devis').select('id, reference, status, montant_ttc, sent_at, signed_at').eq('client_id', id).limit(20),
          supabase.from('calls').select('started_at, direction, duration, summary').eq('client_id', id).order('started_at', { ascending: false }).limit(10),
          supabase.from('taches').select('titre, note, rappel_at').eq('client_id', id).limit(10),
        ])
        if (client.error) throw client.error
        return NextResponse.json({
          client: client.data,
          affaires: affaires.data || [],
          devis: devis.data || [],
          appels: appels.data || [],
          taches: taches.data || [],
        })
      }

      // ---- Appels & transcriptions ---------------------------------------
      case 'recent_calls': {
        const { data, error } = await supabase
          .from('calls')
          .select('pbx_call_id, started_at, direction, caller, callee, duration, summary, status, clients(nom)')
          .order('started_at', { ascending: false })
          .limit(borne(p.limit, 10))
        if (error) throw error
        return NextResponse.json({ appels: data })
      }

      case 'get_call_transcript': {
        const id = String(p.pbx_call_id || '')
        if (!id) return NextResponse.json({ error: 'pbx_call_id requis' }, { status: 400 })
        const { data, error } = await supabase
          .from('calls')
          .select('pbx_call_id, started_at, direction, caller, callee, duration, transcript, summary, extracted, clients(nom)')
          .eq('pbx_call_id', id)
          .single()
        if (error) throw error
        return NextResponse.json({ appel: data })
      }

      case 'search_calls': {
        const q = String(p.q || '').trim()
        if (!q) return NextResponse.json({ error: 'q requis' }, { status: 400 })
        const { data, error } = await supabase
          .from('calls')
          .select('pbx_call_id, started_at, caller, summary')
          .or(`transcript.ilike.%${q}%,summary.ilike.%${q}%,caller.ilike.%${q}%`)
          .order('started_at', { ascending: false })
          .limit(borne(p.limit, 10))
        if (error) throw error
        return NextResponse.json({ appels: data })
      }

      // ---- Devis ---------------------------------------------------------
      case 'list_devis': {
        let req = supabase
          .from('devis')
          .select('id, reference, status, montant_ht, montant_ttc, sent_at, read_at, signed_at, expires_at, clients(nom)')
          .order('created_at', { ascending: false })
          .limit(borne(p.limit, 20))
        if (p.status) req = req.eq('status', String(p.status))
        const { data, error } = await req
        if (error) throw error
        return NextResponse.json({ devis: data })
      }

      case 'devis_claudus': {
        let req = supabase
          .from('devis_claudus')
          .select('numero, created_at, created_by, client_nom, client_ville, reference, montant_ht, montant_ttc, marge_ht, taux_marge_pct')
          .order('created_at', { ascending: false })
          .limit(borne(p.limit, 20))
        const q = String(p.client || '').trim()
        if (q) req = req.ilike('client_nom', `%${q}%`)
        const { data, error } = await req
        if (error) throw error
        return NextResponse.json({ devis_claudus: data })
      }

      case 'devis_claudus_pdf': {
        const numero = String(p.numero || '').trim()
        if (!numero) return NextResponse.json({ error: 'numero requis' }, { status: 400 })

        const { data: devis, error } = await supabase
          .from('devis_claudus')
          .select('numero, client_nom, pdf_path, pdf_filename, montant_ttc')
          .eq('numero', numero)
          .single()
        if (error) throw error
        if (!devis?.pdf_path) {
          return NextResponse.json({ error: `Aucun PDF pour le devis ${numero}` }, { status: 404 })
        }

        // Bucket privé : lien signé de courte durée (5 min), jamais d'URL publique.
        const { data: signed, error: errSign } = await supabase.storage
          .from('devis-claudus-pdfs')
          .createSignedUrl(devis.pdf_path, 300)
        if (errSign || !signed?.signedUrl) {
          return NextResponse.json({ error: 'Lien du PDF indisponible' }, { status: 500 })
        }

        return NextResponse.json({
          numero: devis.numero,
          client: devis.client_nom,
          filename: devis.pdf_filename,
          montant_ttc: devis.montant_ttc,
          url: signed.signedUrl,
          expire_dans_s: 300,
        })
      }

      // ---- Leads leboncoin -----------------------------------------------
      case 'recent_leads': {
        let req = supabase
          .from('lbc_leads')
          .select('conversation_id, contact_name, ad_title, city, departement, statut, telephone, dernier_message, dernier_message_date, unread_count')
          .order('dernier_message_date', { ascending: false })
          .limit(borne(p.limit, 20))
        if (p.statut) req = req.eq('statut', String(p.statut))
        const { data, error } = await req
        if (error) throw error
        return NextResponse.json({ leads: data })
      }

      // ---- Suivi ----------------------------------------------------------
      case 'taches': {
        const { data, error } = await supabase
          .from('taches')
          .select('id, titre, note, rappel_at, client_id, affaire_id')
          .order('rappel_at', { ascending: true })
          .limit(borne(p.limit, 20))
        if (error) throw error
        return NextResponse.json({ taches: data })
      }

      case 'stats': {
        const compte = async (t: string) =>
          (await supabase.from(t).select('*', { count: 'exact', head: true })).count ?? 0
        const [clients, devis, devisClaudus, appels, leads] = await Promise.all([
          compte('clients'), compte('devis'), compte('devis_claudus'),
          compte('calls'), compte('lbc_leads'),
        ])
        return NextResponse.json({ clients, devis, devis_claudus: devisClaudus, appels, leads })
      }

      default:
        return NextResponse.json(
          {
            error: 'Action inconnue',
            actions: [
              'search_clients', 'get_client', 'recent_calls', 'get_call_transcript',
              'search_calls', 'list_devis', 'devis_claudus', 'devis_claudus_pdf',
              'recent_leads', 'taches', 'stats',
            ],
          },
          { status: 400 }
        )
    }
  } catch {
    // Message générique : pas de détail interne renvoyé à l'appelant
    return NextResponse.json({ error: 'Erreur lors de la consultation' }, { status: 500 })
  }
}
