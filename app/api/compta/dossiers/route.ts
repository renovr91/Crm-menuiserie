import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../_lib'

/**
 * LES AFFAIRES, PAS LES DOCUMENTS.
 *
 * POURQUOI : l'écran listait des factures et répondait donc « reste 0 » sur un
 * acompte soldé — exact pour le document, trompeur pour l'affaire, où le client
 * doit encore la moitié. Le gérant lit son activité par CLIENT : « 1 203 €,
 * 601,50 payés, 601,50 restants ». C'est cette vue-là qui fait foi à l'écran ;
 * la découpe acompte/solde est une contrainte de facturation, pas une façon de
 * suivre son chiffre.
 *
 * Une affaire = un devis. On additionne ce qui a RÉELLEMENT été encaissé sur
 * ses factures (annulées exclues), et on compare au montant du devis.
 */
export async function GET(req: NextRequest) {
  const sb = admin()
  const env = envFacturation(req)

  const { data: factures, error } = await sb
    .from('factures')
    .select('id, numero, type, statut, client, devis_numero, total_ttc, emise_le, facture_liee, pdf_path')
    .eq('environnement', env)
    .neq('statut', 'brouillon')
    .order('emise_le', { ascending: true })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Une facture annulée par un avoir ne compte ni comme facturée ni comme due —
  // mais seulement si le(s) avoir(s) COUVRENT SON MONTANT TOTAL. Un avoir
  // partiel (ex. remise sur un reliquat de règlement) ne doit pas faire
  // disparaître toute la facture : avant ce correctif, une facture de
  // 9 995,92 € intégralement payée s'affichait « annulée » et barrée à cause
  // d'un avoir de 216,30 € portant sur un simple arrondi.
  const totalParFacture = new Map<string, number>()
  for (const f of factures || []) totalParFacture.set(f.id, Number(f.total_ttc))
  const avoirsParFacture = new Map<string, number>()
  for (const f of factures || []) {
    if (f.type === 'avoir' && f.facture_liee && f.statut !== 'brouillon') {
      avoirsParFacture.set(f.facture_liee, (avoirsParFacture.get(f.facture_liee) || 0) + Number(f.total_ttc))
    }
  }
  const annulees = new Set(
    [...avoirsParFacture.entries()]
      .filter(([id, montant]) => montant >= (totalParFacture.get(id) || 0) - 0.01)
      .map(([id]) => id),
  )

  const ids = (factures || []).map((f) => f.id)
  const encaisse: Record<string, number> = {}
  if (ids.length) {
    const { data: paiements } = await sb
      .from('facture_paiements').select('facture_id, montant').in('facture_id', ids)
    for (const p of paiements || []) {
      encaisse[p.facture_id] = (encaisse[p.facture_id] || 0) + Number(p.montant)
    }
  }

  // Le montant de l'affaire vient du DEVIS : c'est lui que le client a signé,
  // et il reste vrai même quand une seule facture d'acompte a été émise.
  const refs = [...new Set((factures || []).map((f) => f.devis_numero).filter(Boolean))] as string[]
  const devis: Record<string, { montant: number; client: string | null }> = {}
  if (refs.length) {
    const { data: ds } = await sb
      .from('devis_claudus').select('numero, montant_ttc, client_nom').in('numero', refs)
    for (const d of ds || []) devis[d.numero] = { montant: Number(d.montant_ttc || 0), client: d.client_nom }
  }

  // L'état d'avancement (payé, commandé, livré) vit dans le registre des
  // dossiers : l'afficher ici évite d'ouvrir un second onglet pour le savoir.
  const etapes: Record<string, string> = {}
  if (refs.length) {
    const { data: cs } = await sb.from('commandes').select('devis_numero, stage').in('devis_numero', refs)
    for (const c of cs || []) if (c.devis_numero) etapes[c.devis_numero] = c.stage
  }

  const parAffaire = new Map<string, {
    reference: string; client: string | null; montant_commande: number
    encaisse: number; facture: number; etape: string | null
    documents: { numero: string | null; type: string; statut: string; total_ttc: number; emise_le: string | null; annulee: boolean; encaisse: number; pdf: boolean }[]
  }>()

  for (const f of factures || []) {
    const ref = f.devis_numero || f.numero || '—'
    if (!parAffaire.has(ref)) {
      const client = (f.client || {}) as { nom?: string }
      parAffaire.set(ref, {
        reference: ref,
        client: devis[ref]?.client || client.nom || null,
        montant_commande: devis[ref]?.montant ?? 0,
        encaisse: 0, facture: 0, etape: etapes[ref] || null, documents: [],
      })
    }
    const a = parAffaire.get(ref)!
    const annulee = annulees.has(f.id)
    const recu = encaisse[f.id] || 0
    if (!annulee && f.type !== 'avoir') {
      a.facture += Number(f.total_ttc)
      a.encaisse += recu
    }
    a.documents.push({
      numero: f.numero, type: f.type, statut: f.statut,
      total_ttc: Number(f.total_ttc), emise_le: f.emise_le,
      annulee, encaisse: recu, pdf: !!f.pdf_path,
    })
  }

  const affaires = [...parAffaire.values()].map((a) => {
    // Si aucun devis n'est rattaché, l'affaire vaut ce qui a été facturé —
    // sinon on afficherait « reste : −601,50 € » sur une vente au comptoir.
    const total = a.montant_commande > 0 ? a.montant_commande : a.facture
    return {
      ...a,
      montant_commande: total,
      reste: Math.round((total - a.encaisse) * 100) / 100,
      // Ce qui est dû MAIS PAS ENCORE RÉCLAMÉ : le solde d'une affaire dont
      // seul l'acompte est facturé. Invisible jusqu'ici, et c'est de l'argent.
      a_facturer: Math.round(Math.max(0, total - a.facture) * 100) / 100,
      documents: a.documents.sort((x, y) => String(y.emise_le).localeCompare(String(x.emise_le))),
    }
  }).sort((x, y) => String(y.documents[0]?.emise_le).localeCompare(String(x.documents[0]?.emise_le)))

  return NextResponse.json({
    affaires,
    totaux: {
      encaisse: Math.round(affaires.reduce((s, a) => s + a.encaisse, 0) * 100) / 100,
      reste: Math.round(affaires.reduce((s, a) => s + Math.max(0, a.reste), 0) * 100) / 100,
      a_facturer: Math.round(affaires.reduce((s, a) => s + a.a_facturer, 0) * 100) / 100,
    },
  })
}
