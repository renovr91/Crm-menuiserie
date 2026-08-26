import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Crée un BROUILLON de facture d'acompte à partir d'un devis signé.
 * N'émet rien : la numérotation légale ne démarre qu'à l'appel de /emettre.
 * Par défaut en environnement 'test' — passer environnement:'prod' explicitement.
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const numero = String(body.numero || '').trim()
  if (!numero) return NextResponse.json({ error: 'numéro de devis requis' }, { status: 400 })

  const environnement = body.environnement === 'prod' ? 'prod' : 'test'
  const supabase = createAdminClient()

  const { data: devis, error: errDevis } = await supabase
    .from('devis_claudus')
    .select('numero, client_nom, client_civilite, client_adresse, client_cp, client_ville, montant_ht, montant_ttc, tva_taux, acompte_pct, conditions_reglement, pose, livraison')
    .eq('numero', numero)
    .maybeSingle()

  if (errDevis) return NextResponse.json({ error: errDevis.message }, { status: 500 })
  if (!devis) return NextResponse.json({ error: `devis ${numero} introuvable` }, { status: 404 })

  const pct = Number(body.acompte_pct ?? devis.acompte_pct ?? 0)
  if (!(pct > 0)) {
    return NextResponse.json({ error: "ce devis n'a pas de pourcentage d'acompte" }, { status: 400 })
  }
  const tva = Number(devis.tva_taux ?? 20)
  if (![0, 5.5, 10, 20].includes(tva)) {
    return NextResponse.json({ error: `taux de TVA du devis non conforme : ${tva}` }, { status: 400 })
  }
  const acompteHt = Math.round(((Number(devis.montant_ht) || 0) * pct) / 100 * 100) / 100
  if (!(acompteHt > 0)) return NextResponse.json({ error: 'montant HT du devis manquant' }, { status: 400 })

  // Le moteur exige nom + adresse + cp + ville pour émettre : on le dit tout de suite.
  const manquants = ['client_nom', 'client_adresse', 'client_cp', 'client_ville']
    .filter((c) => !String((devis as Record<string, unknown>)[c] || '').trim())
  if (manquants.length) {
    return NextResponse.json(
      { error: `coordonnées client incomplètes sur le devis : ${manquants.join(', ')}` },
      { status: 400 },
    )
  }

  const aPose = !!devis.pose && Object.keys(devis.pose as object).length > 0
  const aujourdhui = new Date().toISOString().slice(0, 10)

  const payload = {
    environnement,
    type: 'acompte',
    devis_numero: devis.numero,
    // menuiserie posée = prestation + biens ; sans pose, vente de biens
    categorie_operation: body.categorie_operation || (aPose ? 'mixte' : 'biens'),
    client: {
      nom: [devis.client_civilite, devis.client_nom].filter(Boolean).join(' ').trim(),
      adresse: devis.client_adresse,
      cp: devis.client_cp,
      ville: devis.client_ville,
    },
    lignes: [
      {
        designation: `Acompte ${pct}% sur devis ${devis.numero}`,
        quantite: 1,
        prix_unitaire_ht: acompteHt,
        tva,
      },
    ],
    date_vente: aujourdhui,
    // Un acompte est exigible à réception.
    date_echeance: body.date_echeance || aujourdhui,
    conditions_reglement: devis.conditions_reglement || 'Acompte payable à réception',
  }

  const { data: id, error } = await supabase.rpc('facture_creer_brouillon', {
    payload,
    acteur: body.acteur || 'CRM',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    facture_id: id,
    environnement,
    acompte_ht: acompteHt,
    acompte_ttc: Math.round(acompteHt * (1 + tva / 100) * 100) / 100,
    message: 'Brouillon créé — il reste à émettre pour lui donner un numéro.',
  })
}
