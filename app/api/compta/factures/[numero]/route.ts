import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../../_lib'

// GET /api/compta/factures/FA-2026-00001 — détail : facture + paiements + journal
export async function GET(req: NextRequest, ctx: { params: Promise<{ numero: string }> }) {
  try {
    const { numero } = await ctx.params
    const sb = admin()
    const { data: f, error } = await sb
      .from('factures')
      .select('*')
      .eq('numero', numero)
      .eq('environnement', envFacturation(req))
      .single()
    if (error || !f) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

    const [{ data: paiements }, { data: evenements }] = await Promise.all([
      sb.from('facture_paiements').select('montant, moyen, date_paiement, reference, note, saisi_par, created_at')
        .eq('facture_id', f.id).order('date_paiement'),
      sb.from('facture_evenements').select('evenement, acteur, details, created_at')
        .eq('facture_id', f.id).order('created_at'),
    ])
    return NextResponse.json({ ...f, paiements: paiements || [], evenements: evenements || [] })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
