import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Écran de pointage bancaire : les mouvements d'un côté, ce qui attend un
// règlement de l'autre, et les correspondances PROBABLES entre les deux.
//
// POURQUOI ASSISTÉ ET NON AUTOMATIQUE : les libellés du CIC ne portent aucune
// référence — « VIR INST RENOV-R LIBELLÉ NON RENSEIGNÉ » revient sans cesse.
// Un rapprochement sur le seul montant confondrait deux devis identiques (deux
// portes semblables, deux acomptes de 40 %), et on découvrirait l'erreur en
// relançant un client qui a déjà payé. La machine propose, l'humain tranche.

// Écart toléré entre le mouvement et le montant attendu : les arrondis de TVA
// et d'acompte se jouent au centime, pas à l'euro près.
const TOLERANCE_EUR = 1
// Un règlement arrive rarement plus de deux mois après l'émission ; au-delà, la
// coïncidence de montant ne veut plus rien dire.
const FENETRE_JOURS = 75

type Candidat = {
  type: 'facture' | 'devis'
  id: string
  reference: string
  client: string | null
  montant_attendu: number
  emis_le: string | null
  motif: string
}

export async function GET(request: Request) {
  const sb = createAdminClient()
  const url = new URL(request.url)
  const inclureTraitees = url.searchParams.get('tout') === '1'

  let req = sb
    .from('operations_bancaires')
    .select('*')
    .order('date_operation', { ascending: false })
    .limit(200)
  if (!inclureTraitees) {
    req = req.is('pointee_le', null).is('ignoree_le', null)
  }
  const { data: operations, error } = await req
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Ce qui attend un règlement. Les deux sources coexistent : aujourd'hui les
  // devis, les factures dès qu'il y en aura — sans rien à refaire le jour venu.
  const [{ data: impayees }, { data: devis }] = await Promise.all([
    sb.from('factures_impayees').select('*').limit(300),
    sb
      .from('devis')
      .select('id, reference, montant_ttc, acompte_pct, signed_at, payment_status, clients(nom)')
      .neq('payment_status', 'paye')
      .not('signed_at', 'is', null)
      .limit(300),
  ])

  const candidats: Candidat[] = []
  for (const f of impayees || []) {
    const restant = Number((f as Record<string, unknown>).restant ?? 0)
    if (!restant) continue
    candidats.push({
      type: 'facture',
      id: String((f as Record<string, unknown>).id ?? ''),
      reference: String((f as Record<string, unknown>).numero ?? ''),
      client: ((f as Record<string, unknown>).client_nom as string) ?? null,
      montant_attendu: restant,
      emis_le: ((f as Record<string, unknown>).emise_le as string) ?? null,
      motif: 'facture impayée',
    })
  }
  for (const d of devis || []) {
    const pct = Number(d.acompte_pct) || 0
    const total = Number(d.montant_ttc) || 0
    // Un devis avec acompte peut être réglé en deux fois : les deux montants
    // sont des correspondances plausibles, on ne choisit pas à sa place.
    const attendus = pct > 0
      ? [{ m: Math.round(total * pct) / 100, quoi: `acompte ${pct} %` }, { m: total, quoi: 'solde total' }]
      : [{ m: total, quoi: 'montant total' }]
    for (const a of attendus) {
      if (!a.m) continue
      candidats.push({
        type: 'devis',
        id: d.id,
        reference: d.reference,
        client: (Array.isArray(d.clients) ? d.clients[0]?.nom : (d.clients as { nom: string } | null)?.nom) ?? null,
        montant_attendu: a.m,
        emis_le: d.signed_at,
        motif: `devis signé — ${a.quoi}`,
      })
    }
  }

  const lignes = (operations || []).map((o) => {
    const montant = Number(o.montant)
    // On ne propose rien sur un débit ni sur du provisoire : une provision de
    // chèque en attente sera annulée, la rapprocher créerait un faux paiement.
    const rapprochable = montant > 0 && o.definitive && !o.pointee_le && !o.ignoree_le
    const suggestions = rapprochable
      ? candidats
          .filter((c) => Math.abs(c.montant_attendu - montant) <= TOLERANCE_EUR)
          .filter((c) => {
            if (!c.emis_le) return true
            const jours =
              (new Date(o.date_operation).getTime() - new Date(c.emis_le).getTime()) / 86400000
            return jours >= -2 && jours <= FENETRE_JOURS
          })
          .sort((a, b) => {
            // Le plus proche dans le temps d'abord : à montant égal, c'est le
            // meilleur départage dont on dispose.
            const da = a.emis_le ? Math.abs(new Date(o.date_operation).getTime() - new Date(a.emis_le).getTime()) : Infinity
            const db = b.emis_le ? Math.abs(new Date(o.date_operation).getTime() - new Date(b.emis_le).getTime()) : Infinity
            return da - db
          })
          .slice(0, 5)
      : []
    return { ...o, montant, suggestions }
  })

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
      { error: 'Opération provisoire : elle sera annulée par la banque, elle ne doit pas être rapprochée.' },
      { status: 400 },
    )
  }

  const type = String(corps.type || '')
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

  return NextResponse.json({ ok: true, etat: 'pointée', type })
}
