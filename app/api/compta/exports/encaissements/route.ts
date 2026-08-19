import { NextRequest, NextResponse } from 'next/server'
import { admin, csvResponse, envFacturation, MOYENS_LABELS } from '../../_lib'

// Comptes de trésorerie indicatifs (à valider par l'expert-comptable).
const COMPTE_TRESO: Record<string, string> = {
  virement: '512', cb_monetico: '512', cheque: '5112', especes: '53',
}

// GET /api/compta/exports/encaissements?debut&fin → CSV des paiements reçus.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const debut = searchParams.get('debut')
    const fin = searchParams.get('fin')
    if (!debut || !fin) return NextResponse.json({ error: 'debut et fin requis' }, { status: 400 })

    const sb = admin()
    const { data, error } = await sb
      .from('facture_paiements')
      .select('montant, moyen, date_paiement, reference, note, saisi_par, factures!inner(numero, client, environnement)')
      .eq('factures.environnement', envFacturation(req))
      .gte('date_paiement', debut)
      .lte('date_paiement', fin)
      .order('date_paiement')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const lignes: (string | number | null)[][] = [[
      'Date', 'Facture', 'Client', 'Moyen', 'Compte', 'Référence', 'Montant', 'Saisi par',
    ]]
    for (const p of data || []) {
      const f = p.factures as unknown as { numero: string; client: { civilite?: string; nom?: string } }
      lignes.push([
        p.date_paiement, f.numero,
        `${f.client?.civilite || ''} ${f.client?.nom || ''}`.trim(),
        MOYENS_LABELS[p.moyen] || p.moyen, COMPTE_TRESO[p.moyen] || '',
        p.reference || p.note || '', Number(p.montant).toFixed(2).replace('.', ','), p.saisi_par || '',
      ])
    }
    return csvResponse(`encaissements_${debut}_${fin}.csv`, lignes)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
