import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
//  Création d'un BROUILLON de facture — logique partagée.
//
//  POURQUOI CE FICHIER : la route /api/factures/creer porte cette logique pour
//  le back-office, et la route /api/agent doit l'offrir à Hermes. La première
//  version faisait un fetch HTTP interne de l'une vers l'autre — bloqué par le
//  middleware, qui ne connaît pas cet appelant. Panne découverte par Hermes
//  lui-même le 27/08/2026 (« Erreur lors de la consultation », deux tentatives).
//  Une fonction appelée directement n'a pas de videur à franchir.
//
//  Voir la route pour la documentation d'usage ; elle n'est plus qu'une
//  enveloppe HTTP autour de ceci.
// ============================================================================

type Reponse = { status: number; corps: Record<string, unknown> }
const reponse = (corps: Record<string, unknown>, status: number): Reponse => ({ status, corps })

type Ligne = { designation: string; details?: string; quantite: number; prix_unitaire_ht: number; tva: number }

const TVA_ADMISES = [0, 5.5, 10, 20]


export async function creerBrouillonFacture(
  supabase: SupabaseClient,
  body: Record<string, any>,
): Promise<Reponse> {
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
      return reponse({ error: `Devis ${devisNumero} introuvable` }, 404)
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
    return reponse({
        error: `Coordonnées client incomplètes : ${manquants.join(', ')}`,
        aide: devisNumero
          ? `Le devis ${devisNumero} ne les porte pas séparément. Fournis-les dans « client ».`
          : 'Fournis nom, adresse, cp et ville dans « client ».',
      },
      400)
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
        // Le VISUEL n'est repris que s'il a été archivé par devis dans le
        // bucket (chemin « visuels/DC-xxxxx/i.png »). Un chemin local du VPS
        // est ignoré : ces fichiers s'écrasent entre devis, et une facture
        // montrerait la configuration d'un autre client.
        ...(typeof l.image === 'string' && l.image.startsWith('visuels/')
          ? { image: l.image, image_cote: true, image_raw: true }
          : {}),
        quantite: Number(l.quantite) || 1,
        prix_unitaire_ht: Number(l.prix_unitaire_ht),
        tva: Number(l.tva ?? devis?.tva_taux ?? 20),
      }))
  }

  // UN ACOMPTE NE SE FACTURE QU'UNE FOIS, mais il doit DIRE SUR QUOI il porte.
  // Première version (28/08) : une ligne sèche « Acompte 50 % sur devis
  // DC-00925 », et rien d'autre — ni le descriptif des travaux, ni le montant
  // de la commande. Le client lisait « TOTAL TTC 601,50 € » et pouvait croire
  // que la porte coûtait ça. On garde donc UNE SEULE ligne facturée (c'est bien
  // une avance, pas la vente d'articles), mais elle porte le descriptif complet,
  // et le récapitulatif de commande est figé dans `mentions`.
  const pct = Number(body.acompte_pct ?? 0)
  let mentions: Record<string, any> | null = null
  if (type === 'acompte') {
    if (!(pct > 0 && pct < 100)) {
      return reponse({ error: 'Un acompte demande un pourcentage entre 1 et 99' }, 400)
    }
    const baseHt = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht, 0)
    const baseTtc = lignes.reduce(
      (s, l) => s + l.quantite * l.prix_unitaire_ht * (1 + Number(l.tva) / 100), 0)
    const tva = Number(body.tva ?? devis?.tva_taux ?? lignes[0]?.tva ?? 20)
    const montant = Math.round((baseHt * pct) / 100 * 100) / 100
    if (!(montant > 0)) {
      return reponse({ error: 'Montant HT introuvable pour calculer l’acompte' }, 400)
    }

    // Le descriptif de la commande passe SOUS la ligne d'acompte : la
    // désignation seule est trop vague pour l'art. 242 nonies A, et c'est la
    // règle que l'entreprise s'est donnée pour toutes ses factures.
    const descriptif = lignes
      .map((l) => {
        const q = l.quantite > 1 ? ` (× ${l.quantite})` : ''
        return `— ${l.designation}${q}${l.details ? `\n${l.details}` : ''}`
      })
      .join('\n')

    const arrondi = (n: number) => Math.round(n * 100) / 100
    const acompteTtc = arrondi(montant * (1 + tva / 100))
    mentions = {
      acompte: {
        pct,
        devis: devisNumero || null,
        commande_ht: arrondi(baseHt),
        commande_ttc: arrondi(baseTtc),
        facture_ttc: acompteTtc,
        reste_ttc: arrondi(baseTtc - acompteTtc),
      },
    }

    // FACTURE ACQUITTÉE : un acompte est presque toujours facturé APRÈS
    // encaissement (c'est l'encaissement qui rend la TVA exigible, art. 269-2-c
    // CGI). Le document doit donc dire qu'il est payé et afficher un net à
    // payer nul — sans quoi le client lit « TOTAL TTC 601,50 € » comme une
    // somme réclamée. C'est aussi sa preuve de paiement.
    const regleLe = String(body.regle_le || '').trim()
    if (regleLe) {
      const modes: Record<string, string> = {
        virement: 'virement', cheque: 'chèque', especes: 'espèces',
        cb: 'carte bancaire', prelevement: 'prélèvement',
      }
      mentions.reglement = {
        acquittee: true,
        date: regleLe,
        mode: modes[String(body.regle_par || 'virement')] || String(body.regle_par),
        montant_ttc: acompteTtc,
      }
    }

    lignes = [{
      designation: `Acompte ${pct} %${devisNumero ? ` sur devis ${devisNumero}` : ''}`,
      details: descriptif,
      quantite: 1,
      prix_unitaire_ht: montant,
      tva,
    }]
  }

  if (!lignes.length) {
    return reponse({ error: 'Aucune ligne à facturer' }, 400)
  }
  const tvaInvalide = lignes.find((l) => !TVA_ADMISES.includes(Number(l.tva)))
  if (tvaInvalide) {
    return reponse({ error: `Taux de TVA non conforme : ${tvaInvalide.tva}` },
      400)
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
    ...(mentions ? { mentions } : {}),
  }

  const { data: id, error } = await supabase.rpc('facture_creer_brouillon', {
    payload,
    acteur: String(body.acteur || 'CRM'),
  })
  if (error) {
    return reponse({ error: error.message }, 500)
  }

  const totalHt = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht, 0)
  const totalTtc = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht * (1 + Number(l.tva) / 100), 0)

  return reponse({
    ok: true,
    facture_id: id,
    type,
    environnement,
    origine: payload.devis_numero,
    total_ht: Math.round(totalHt * 100) / 100,
    total_ttc: Math.round(totalTtc * 100) / 100,
    message: 'Brouillon créé. Il n’a PAS de numéro : il reste à émettre.',
  }, 200)}
