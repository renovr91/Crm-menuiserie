import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation, somme } from '../_lib'

// GET /api/compta/dashboard — 12 mois glissants : facturé (FA − AV), encaissé,
// nb factures, marge (via devis_claudus.montant_achat_ht quand le devis est lié).
export async function GET(req: NextRequest) {
  try {
    const sb = admin()
    const env = envFacturation(req)
    const depuis = new Date()
    depuis.setMonth(depuis.getMonth() - 11)
    depuis.setDate(1)
    const depuisIso = depuis.toISOString().slice(0, 10)

    const [{ data: factures, error: e1 }, { data: paiements, error: e2 }, { data: impayes }] = await Promise.all([
      sb.from('factures')
        .select('id, numero, serie, type, total_ht, total_ttc, emise_le, emise_par, devis_numero')
        .eq('environnement', env).neq('statut', 'brouillon').gte('emise_le', depuisIso),
      sb.from('facture_paiements')
        .select('montant, date_paiement, facture_id, factures!inner(environnement)')
        .eq('factures.environnement', env).gte('date_paiement', depuisIso),
      sb.from('factures_impayees').select('restant'),
    ])
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    // Marge : achat des devis liés
    const numerosDevis = Array.from(new Set((factures || []).map((f) => f.devis_numero).filter(Boolean))) as string[]
    const achatParDevis: Record<string, number | null> = {}
    if (numerosDevis.length) {
      const { data: devis } = await sb
        .from('devis_claudus').select('numero, montant_achat_ht').in('numero', numerosDevis)
      for (const d of devis || []) achatParDevis[d.numero] = d.montant_achat_ht === null ? null : Number(d.montant_achat_ht)
    }

    type Mois = { mois: string; facture_ttc: number; encaisse: number; nb: number; marge_ht: number | null }
    const parMois: Record<string, Mois> = {}
    const cle = (d: string) => String(d).slice(0, 7)
    const initMois = (m: string) => (parMois[m] ||= { mois: m, facture_ttc: 0, encaisse: 0, nb: 0, marge_ht: null })

    for (const f of factures || []) {
      const m = initMois(cle(f.emise_le))
      const signe = f.serie === 'AV' ? -1 : 1
      m.facture_ttc = somme([m.facture_ttc, signe * Number(f.total_ttc)])
      m.nb += 1
      if (f.devis_numero && achatParDevis[f.devis_numero] != null && f.serie !== 'AV') {
        const marge = somme([Number(f.total_ht), -Number(achatParDevis[f.devis_numero])])
        m.marge_ht = somme([m.marge_ht || 0, marge])
      }
    }
    for (const p of paiements || []) {
      const m = initMois(cle(p.date_paiement))
      m.encaisse = somme([m.encaisse, Number(p.montant)])
    }

    const mois = Object.values(parMois).sort((a, b) => a.mois.localeCompare(b.mois))
    const totalImpayes = somme((impayes || []).map((i) => Number(i.restant)))
    const moisCourant = new Date().toISOString().slice(0, 7)
    const courant = parMois[moisCourant] || { facture_ttc: 0, encaisse: 0, nb: 0, marge_ht: null }

    return NextResponse.json({
      mois,
      courant: { ...courant, mois: moisCourant },
      total_impayes: totalImpayes,
      nb_impayes: (impayes || []).length,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
