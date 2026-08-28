import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { calculerPointage } from '@/lib/pointage'

export const dynamic = 'force-dynamic'

// Écran de pointage bancaire : les mouvements d'un côté, ce qui attend un
// règlement de l'autre, et les correspondances PROBABLES entre les deux.
//
// POURQUOI ASSISTÉ ET NON AUTOMATIQUE : les libellés du CIC ne portent aucune
// référence — « VIR INST RENOV-R LIBELLÉ NON RENSEIGNÉ » revient sans cesse.
// Un rapprochement sur le seul montant confondrait deux devis identiques (deux
// portes semblables, deux acomptes de 40 %), et on découvrirait l'erreur en
// relançant un client qui a déjà payé. La machine propose, l'humain tranche.

export async function GET(request: Request) {
  const sb = createAdminClient()
  const url = new URL(request.url)
  // RECHERCHE MANUELLE — le filet de sécurité quand rien n'est proposé.
  // Le client oublie souvent la référence, et certains devis viennent d'un autre
  // outil (ProDevis) et n'existent pas en base. Sans ce mode, l'écran ne laissait
  // que « écarter » : on aurait fait disparaître de vrais encaissements clients.
  const q = (url.searchParams.get('q') || '').trim()
  if (q) {
    const { data } = await sb
      .from('devis_claudus')
      .select('id, numero, client_nom, montant_ttc, acompte_pct, created_at')
      .or(`numero.ilike.%${q}%,client_nom.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20)
    return NextResponse.json({
      resultats: (data || []).map((d) => ({
        type: 'devis' as const,
        id: d.id,
        reference: d.numero,
        client: d.client_nom,
        montant_attendu: Number(d.montant_ttc) || 0,
        emis_le: d.created_at,
        motif: 'recherche manuelle',
      })),
    })
  }
  const inclureTraitees = url.searchParams.get('tout') === '1'

  let lignes, candidats
  try {
    ;({ lignes, candidats } = await calculerPointage(sb, inclureTraitees))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }

  return NextResponse.json({
    operations: lignes,
    total_a_pointer: lignes.filter((l) => !l.pointee_le && !l.ignoree_le).length,
    // Le nombre de candidats dit si l'absence de suggestion vient d'un manque
    // de correspondance… ou d'une base vide. Ce n'est pas la même conclusion.
    candidats_disponibles: candidats.length,
  })
}

// Pointer une opération, ou l'écarter. Deux gestes, une seule route : dans les
// deux cas l'opération sort de la liste, et c'est ce qui compte pour l'écran.
export async function POST(request: Request) {
  const sb = createAdminClient()
  let corps: Record<string, unknown>
  try {
    corps = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const id = Number(corps.id)
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const { data: op } = await sb
    .from('operations_bancaires')
    .select('id, montant, definitive, pointee_le, ignoree_le')
    .eq('id', id)
    .maybeSingle()
  if (!op) return NextResponse.json({ error: 'Opération inconnue' }, { status: 404 })

  // « Annuler » : on rend la ligne à la liste. Une erreur de pointage doit se
  // défaire, sinon on n'ose plus cliquer.
  if (corps.action === 'annuler') {
    const { error } = await sb
      .from('operations_bancaires')
      .update({ pointee_le: null, pointee_par: null, facture_id: null, devis_numero: null, ignoree_le: null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'rendue à pointer' })
  }

  if (corps.action === 'ignorer') {
    const { error } = await sb
      .from('operations_bancaires')
      .update({ ignoree_le: new Date().toISOString(), note: (corps.note as string) || null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'écartée' })
  }

  if (op.pointee_le) {
    return NextResponse.json({ error: 'Opération déjà pointée' }, { status: 409 })
  }
  if (!op.definitive) {
    return NextResponse.json(
      { error: 'Écriture encore provisoire chez la banque : attendre qu’elle soit définitive.' },
      { status: 400 },
    )
  }

  const type = String(corps.type || '')

  // RÉFÉRENCE LIBRE : un devis produit par ProDevis n'est pas en base. On note
  // alors le numéro tel quel. L'opération sort de la liste et le lien reste
  // tracé — au lieu d'être « écartée », ce qui l'aurait fait disparaître de la
  // comptabilité alors que c'est un vrai encaissement client.
  if (type === 'libre') {
    const ref = String(corps.reference || '').trim()
    if (!ref) return NextResponse.json({ error: 'référence requise' }, { status: 400 })
    const { error } = await sb
      .from('operations_bancaires')
      .update({
        pointee_le: new Date().toISOString(),
        pointee_par: 'crm:manuel',
        devis_numero: ref.slice(0, 60),
        note: (corps.note as string) || 'rattachement manuel',
      })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'pointée', type: 'libre', reference: ref })
  }

  const cible = String(corps.cible || '')
  if (!cible) return NextResponse.json({ error: 'cible requise' }, { status: 400 })

  // Sur une facture, on enregistre un VRAI paiement via la RPC existante :
  // c'est elle qui tient le statut et le restant dû, pas cet écran.
  if (type === 'facture') {
    const { error: eRpc } = await sb.rpc('facture_saisir_paiement', {
      p_facture_id: cible,
      p_montant: Number(op.montant),
      p_moyen: 'virement',
      p_date: String(corps.date || new Date().toISOString().slice(0, 10)),
      p_reference: (corps.reference as string) || null,
      p_note: 'pointage bancaire',
      p_acteur: 'crm:pointage',
    })
    if (eRpc) return NextResponse.json({ error: eRpc.message }, { status: 400 })
  }

  const { error } = await sb
    .from('operations_bancaires')
    .update({
      pointee_le: new Date().toISOString(),
      pointee_par: 'crm',
      facture_id: type === 'facture' ? cible : null,
      devis_numero: type === 'devis' ? String(corps.reference || cible) : null,
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Le DOSSIER CLIENT avance tout seul : un virement rapproché d'un devis fait
  // passer sa commande en « à commander » — c'est le déclencheur du rappel
  // quotidien « commande la marchandise ». Chèque, espèces et CB, eux, passent
  // par l'agent (« il m'a réglé par chèque ») : la banque ne les voit pas assez
  // vite ou pas du tout.
  if (type === 'devis') {
    const ref = String(corps.reference || '')
    if (ref) {
      await sb
        .from('commandes')
        .update({
          stage: 'a_commander',
          paye_le: String(corps.date || new Date().toISOString().slice(0, 10)),
          paye_via: 'virement',
          updated_at: new Date().toISOString(),
        })
        .eq('devis_numero', ref)
        .eq('stage', 'signe')
    }
  }

  return NextResponse.json({ ok: true, etat: 'pointée', type })
}
