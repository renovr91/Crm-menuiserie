import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// ============================================================================
//  Création d'une facture — BROUILLON uniquement.
//
//  POURQUOI CETTE ROUTE : il n'existait que `factures/acompte`, qui refuse un
//  devis sans pourcentage d'acompte. Un client réglant la totalité — le cas le
//  plus courant hors pose — ne pouvait donc pas être facturé du tout.
//
//  DEUX SOURCES, UNE SEULE ROUTE :
//   - un devis `devis_claudus` : ses lignes et son client préremplissent tout ;
//   - RIEN du tout : l'entreprise utilise aussi ProDevis, dont les devis ne sont
//     pas en base. La facture se fait alors sur les seules données fournies, la
//     référence externe étant simplement notée.
//  Dans les deux cas, les coordonnées client fournies PRIMENT sur celles du
//  devis. C'est indispensable : un devis peut être signé et parfaitement valide
//  tout en portant une adresse mal découpée — il ne faut ni le modifier ni
//  renoncer à facturer.
//
//  ⚠️ CETTE ROUTE N'ÉMET PAS. Elle crée un brouillon, sans numéro. L'émission
//  (`factures/emettre`) attribue le numéro séquentiel et verrouille la chaîne de
//  hachage : elle ne se défait que par un avoir. Ce geste reste humain.
// ============================================================================

type Ligne = { designation: string; details?: string; quantite: number; prix_unitaire_ht: number; tva: number }

const TVA_ADMISES = [0, 5.5, 10, 20]

export async function POST(request: Request) {
  const supabase = createAdminClient()

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const environnement = body.environnement === 'prod' ? 'prod' : 'test'
  const type = ['facture', 'acompte', 'solde'].includes(String(body.type)) ? String(body.type) : 'facture'
  const devisNumero = String(body.devis_numero || '').trim()

  // ---- 1. Le devis, s'il existe en base : il préremplit, il ne contraint pas.
  let devis: Record<string, any> | null = null
  if (devisNumero) {
    const { data } = await supabase
      .from('devis_claudus')
      .select('numero, client_nom, client_civilite, client_adresse, client_cp, client_ville, montant_ht, tva_taux, acompte_pct, conditions_reglement, pose, lignes')
      .eq('numero', devisNumero)
      .maybeSingle()
    devis = data
    if (!devis) {
      return NextResponse.json({ error: `Devis ${devisNumero} introuvable` }, { status: 404 })
    }
  }

  // ---- 2. Le client. Ce qui est fourni gagne toujours.
  const c = body.client || {}
  const client = {
    nom: String(c.nom || [devis?.client_civilite, devis?.client_nom].filter(Boolean).join(' ') || '').trim(),
    adresse: String(c.adresse || devis?.client_adresse || '').trim(),
    cp: String(c.cp || devis?.client_cp || '').trim(),
    ville: String(c.ville || devis?.client_ville || '').trim(),
  }
  const manquants = (['nom', 'adresse', 'cp', 'ville'] as const).filter((k) => !client[k])
  if (manquants.length) {
    // On nomme précisément ce qui manque : le moteur refuserait à l'émission,
    // beaucoup plus tard, avec un message bien moins clair.
    return NextResponse.json(
      {
        error: `Coordonnées client incomplètes : ${manquants.join(', ')}`,
        aide: devisNumero
          ? `Le devis ${devisNumero} ne les porte pas séparément. Fournis-les dans « client ».`
          : 'Fournis nom, adresse, cp et ville dans « client ».',
      },
      { status: 400 },
    )
  }

  // ---- 3. Les lignes. Celles fournies, sinon celles du devis.
  let lignes: Ligne[] = []
  if (Array.isArray(body.lignes) && body.lignes.length) {
    lignes = body.lignes
  } else if (devis && Array.isArray(devis.lignes)) {
    // Le DESCRIPTIF COMPLET du devis est repris : les mentions obligatoires
    // exigent la dénomination PRÉCISE des biens vendus, et « porte de garage »
    // tout court ne l'est pas. La facture doit dire ce que le devis disait —
    // c'est le même produit, au même prix, décrit pareil (décision 27/08/2026).
    // Seuls les visuels restent au devis : chemins de fichiers du VPS,
    // illisibles d'ici, et sans place sur un document comptable.
    lignes = (devis.lignes as Record<string, any>[])
      .filter((l) => Number(l.prix_unitaire_ht) > 0)
      .map((l) => ({
        designation: String(l.designation || 'Prestation'),
        ...(l.details ? { details: String(l.details) } : {}),
        quantite: Number(l.quantite) || 1,
        prix_unitaire_ht: Number(l.prix_unitaire_ht),
        tva: Number(l.tva ?? devis?.tva_taux ?? 20),
      }))
  }

  // Un acompte se facture en UNE ligne, pas en reprenant le détail : c'est une
  // avance sur l'ensemble, pas la vente d'un article précis.
  const pct = Number(body.acompte_pct ?? 0)
  if (type === 'acompte') {
    if (!(pct > 0 && pct < 100)) {
      return NextResponse.json({ error: 'Un acompte demande un pourcentage entre 1 et 99' }, { status: 400 })
    }
    const baseHt = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht, 0)
    const tva = Number(body.tva ?? devis?.tva_taux ?? lignes[0]?.tva ?? 20)
    const montant = Math.round((baseHt * pct) / 100 * 100) / 100
    if (!(montant > 0)) {
      return NextResponse.json({ error: 'Montant HT introuvable pour calculer l’acompte' }, { status: 400 })
    }
    lignes = [{
      designation: `Acompte ${pct} %${devisNumero ? ` sur devis ${devisNumero}` : ''}`,
      quantite: 1,
      prix_unitaire_ht: montant,
      tva,
    }]
  }

  if (!lignes.length) {
    return NextResponse.json({ error: 'Aucune ligne à facturer' }, { status: 400 })
  }
  const tvaInvalide = lignes.find((l) => !TVA_ADMISES.includes(Number(l.tva)))
  if (tvaInvalide) {
    return NextResponse.json(
      { error: `Taux de TVA non conforme : ${tvaInvalide.tva}` },
      { status: 400 },
    )
  }

  const aujourdhui = new Date().toISOString().slice(0, 10)
  const aPose = !!devis?.pose && Object.keys(devis.pose as object).length > 0

  const payload = {
    environnement,
    type,
    // Le lien vers l'origine, quelle qu'elle soit : un devis maison ou une
    // référence externe (ProDevis). Sans lui, la facture est orpheline et le
    // rapprochement avec l'encaissement devient une enquête.
    devis_numero: devisNumero || String(body.reference_externe || '').trim() || null,
    categorie_operation: body.categorie_operation || (aPose ? 'mixte' : 'biens'),
    client,
    lignes,
    date_vente: String(body.date_vente || aujourdhui),
    date_echeance: String(body.date_echeance || aujourdhui),
    conditions_reglement:
      body.conditions_reglement || devis?.conditions_reglement || 'Paiement à réception de facture',
  }

  const { data: id, error } = await supabase.rpc('facture_creer_brouillon', {
    payload,
    acteur: String(body.acteur || 'CRM'),
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const totalHt = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht, 0)
  const totalTtc = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht * (1 + Number(l.tva) / 100), 0)

  return NextResponse.json({
    ok: true,
    facture_id: id,
    type,
    environnement,
    origine: payload.devis_numero,
    total_ht: Math.round(totalHt * 100) / 100,
    total_ttc: Math.round(totalTtc * 100) / 100,
    message: 'Brouillon créé. Il n’a PAS de numéro : il reste à émettre.',
  })
}
