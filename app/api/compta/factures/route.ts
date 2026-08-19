import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation, somme } from '../_lib'

// GET /api/compta/factures?statut=&type=&q=&limit=
// Liste des factures émises (jamais les brouillons) avec état de règlement.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const statut = searchParams.get('statut') || ''
    const type = searchParams.get('type') || ''
    const q = (searchParams.get('q') || '').toLowerCase()
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '300', 10), 1), 1000)

    const sb = admin()
    let query = sb
      .from('factures')
      .select('id, numero, serie, type, statut, client, devis_numero, total_ht, total_ttc, date_echeance, emise_le, emise_par, pdf_path')
      .eq('environnement', envFacturation(req))
      .neq('statut', 'brouillon')
      .order('numero', { ascending: false })
      .limit(limit)
    if (statut) query = query.eq('statut', statut)
    if (type) query = query.eq('type', type)

    const { data: factures, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const ids = (factures || []).map((f) => f.id)
    const paiementsParFacture: Record<string, number> = {}
    const dernierPaiement: Record<string, string> = {}
    const dernierPdf: Record<string, string> = {}
    if (ids.length) {
      const { data: paiements } = await sb
        .from('facture_paiements')
        .select('facture_id, montant, created_at')
        .in('facture_id', ids)
      for (const p of paiements || []) {
        paiementsParFacture[p.facture_id] = somme([paiementsParFacture[p.facture_id] || 0, Number(p.montant)])
        if (!dernierPaiement[p.facture_id] || p.created_at > dernierPaiement[p.facture_id])
          dernierPaiement[p.facture_id] = p.created_at
      }
      const { data: events } = await sb
        .from('facture_evenements')
        .select('facture_id, evenement, created_at')
        .in('facture_id', ids)
        .eq('evenement', 'pdf_genere')
      for (const e of events || []) {
        if (!dernierPdf[e.facture_id] || e.created_at > dernierPdf[e.facture_id])
          dernierPdf[e.facture_id] = e.created_at
      }
    }

    const rows = (factures || []).map((f) => {
      const paye = paiementsParFacture[f.id] || 0
      const client = (f.client || {}) as { civilite?: string; nom?: string; email?: string }
      return {
        id: f.id,
        numero: f.numero,
        type: f.type,
        statut: f.statut,
        client_nom: `${client.civilite || ''} ${client.nom || ''}`.trim(),
        client_email: client.email || null,
        devis_numero: f.devis_numero,
        total_ht: Number(f.total_ht),
        total_ttc: Number(f.total_ttc),
        paye,
        reste: somme([Number(f.total_ttc), -paye]),
        date_echeance: f.date_echeance,
        emise_le: f.emise_le,
        emise_par: f.emise_par,
        pdf_path: f.pdf_path,
        pdf_a_regenerer: Boolean(
          dernierPaiement[f.id] && (!dernierPdf[f.id] || dernierPaiement[f.id] > dernierPdf[f.id])
        ),
      }
    }).filter((r) => {
      if (!q) return true
      return (
        r.numero.toLowerCase().includes(q) ||
        r.client_nom.toLowerCase().includes(q) ||
        (r.devis_numero || '').toLowerCase().includes(q)
      )
    })

    return NextResponse.json(rows)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
