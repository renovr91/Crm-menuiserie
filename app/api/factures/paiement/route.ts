import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const MOYENS = ['cheque', 'especes', 'cb_monetico', 'virement']

/** Enregistre un règlement sur une facture émise (chèque, espèces, CB, virement). */
export async function POST(request: NextRequest) {
  const b = await request.json()
  if (!b.facture_id) return NextResponse.json({ error: 'facture_id requis' }, { status: 400 })
  if (!MOYENS.includes(String(b.moyen))) {
    return NextResponse.json({ error: `moyen invalide (${MOYENS.join(', ')})` }, { status: 400 })
  }
  const montant = Number(b.montant)
  if (!Number.isFinite(montant) || montant <= 0) {
    return NextResponse.json({ error: 'montant invalide' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('facture_saisir_paiement', {
    p_facture_id: b.facture_id,
    p_montant: montant,
    p_moyen: b.moyen,
    p_date: b.date_paiement || new Date().toISOString().slice(0, 10),
    p_reference: b.reference || null,
    p_note: b.note || null,
    p_acteur: b.acteur || 'CRM',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true, statut: data })
}
