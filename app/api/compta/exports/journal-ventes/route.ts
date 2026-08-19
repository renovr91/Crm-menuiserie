import { NextRequest, NextResponse } from 'next/server'
import { admin, csvResponse, envFacturation } from '../../_lib'

const TAUX = [5.5, 10, 20, 0]
// Comptes de produits indicatifs (à valider par l'expert-comptable) :
// biens → 707 (ventes de marchandises), services → 706, mixte → 708.
const COMPTE_PRODUIT: Record<string, string> = { biens: '707', services: '706', mixte: '708' }
const COMPTE_TVA: Record<string, string> = { '5.5': '445712', '10': '445713', '20': '445714', '0': '' }

// GET /api/compta/exports/journal-ventes?debut&fin → CSV format expert-comptable.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const debut = searchParams.get('debut')
    const fin = searchParams.get('fin')
    if (!debut || !fin) return NextResponse.json({ error: 'debut et fin requis' }, { status: 400 })

    const sb = admin()
    const { data, error } = await sb
      .from('factures')
      .select('numero, serie, type, categorie_operation, client, devis_numero, emise_le, total_ht, total_tva, total_ttc, ventilation_tva')
      .eq('environnement', envFacturation(req))
      .neq('statut', 'brouillon')
      .gte('emise_le', debut)
      .lte('emise_le', fin + 'T23:59:59')
      .order('numero')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const entete = [
      'Date', 'Numéro', 'Type', 'Client', 'Devis', 'Catégorie', 'Compte produit',
      ...TAUX.flatMap((t) => [`Base HT ${t} %`, `TVA ${t} % (${COMPTE_TVA[String(t)] || 'exonéré'})`]),
      'Total HT', 'Total TVA', 'Total TTC',
    ]
    const lignes: (string | number | null)[][] = [entete]
    for (const f of data || []) {
      const signe = f.serie === 'AV' ? -1 : 1
      const client = (f.client || {}) as { civilite?: string; nom?: string }
      const vt: Record<string, { base: number; tva: number }> = {}
      for (const v of (f.ventilation_tva || []) as { taux: number; base_ht: number; tva: number }[]) {
        vt[String(Number(v.taux))] = { base: signe * Number(v.base_ht), tva: signe * Number(v.tva) }
      }
      lignes.push([
        String(f.emise_le).slice(0, 10), f.numero, f.type,
        `${client.civilite || ''} ${client.nom || ''}`.trim(), f.devis_numero || '',
        f.categorie_operation, COMPTE_PRODUIT[f.categorie_operation] || '',
        ...TAUX.flatMap((t) => {
          const e = vt[String(t)]
          return [e ? e.base.toFixed(2).replace('.', ',') : '', e ? e.tva.toFixed(2).replace('.', ',') : '']
        }),
        (signe * Number(f.total_ht)).toFixed(2).replace('.', ','),
        (signe * Number(f.total_tva)).toFixed(2).replace('.', ','),
        (signe * Number(f.total_ttc)).toFixed(2).replace('.', ','),
      ])
    }
    return csvResponse(`journal-ventes_${debut}_${fin}.csv`, lignes)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
