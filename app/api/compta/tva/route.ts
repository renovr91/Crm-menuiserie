import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../_lib'

// GET /api/compta/tva?debut=YYYY-MM-DD&fin=YYYY-MM-DD
// État TVA par taux sur la période (RPC facture_tva_periode) :
// facturée = exigible pour les livraisons de biens ; encaissée = exigible pour
// les prestations (pose). Avoirs déjà déduits par la RPC.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const debut = searchParams.get('debut')
    const fin = searchParams.get('fin')
    if (!debut || !fin) return NextResponse.json({ error: 'debut et fin requis (YYYY-MM-DD)' }, { status: 400 })

    const sb = admin()
    const { data, error } = await sb.rpc('facture_tva_periode', {
      p_debut: debut, p_fin: fin, p_environnement: envFacturation(req),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data || [])
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
