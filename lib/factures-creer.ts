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

export const MOTIF_AUTOLIQUIDATION =
  'Autoliquidation : TVA due par le preneur assujetti (article 283-2 nonies du CGI)'

const arr2 = (n: number) => Math.round(n * 100) / 100

/** Pourcentage à la française : virgule, 2 décimales au plus (« 30,32 »). */
export function pctFr(v: number): string {
  return arr2(Number(v) || 0).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')
}

/** L'intitulé d'une ligne d'acompte : rang, pourcentage à la française, objet. */
export function intituleAcompte(rang: number, pct: number, resume: string, devisNumero = ''): string {
  return `Acompte n° ${rang} de ${pctFr(pct)} % sur ${resume || 'la commande'}` +
    `${devisNumero ? `, selon devis ${devisNumero} accepté` : ''}`
}

/** CHANTIER (solde à l'achèvement des travaux) ou simple fourniture ?
 *  Le devis en base ne suffit pas : une commande d'une référence externe
 *  (ProDevis, COM…) n'en a pas, et ses acomptes sortaient « avant la
 *  livraison », pose comprise (KAB, 21/10/2026). Sont un chantier : un devis
 *  avec pose, une catégorie mixte ou prestation, l'autoliquidation
 *  (sous-traitance de travaux), ou une ligne de pose. */
export function estChantier(o: {
  aPoseDevis?: boolean; categorie?: string | null; autoliquidation?: boolean
  motifTvaZero?: string | null; lignes?: { designation?: string }[]
}): boolean {
  if (o.aPoseDevis) return true
  if (o.categorie === 'mixte' || o.categorie === 'services') return true
  if (o.autoliquidation || /autoliquidation|283-2 nonies/i.test(String(o.motifTvaZero || ''))) return true
  return (o.lignes || []).some((l) => {
    const d = String(l.designation || '')
    return /\bpose\b|\binstallation\b|main[- ]d['’](œ|oe)uvre/i.test(d) && !/\b(hors|sans) pose\b/i.test(d)
  })
}

const MODES_REGLEMENT: Record<string, string> = {
  virement: 'virement', cheque: 'chèque', 'chèque': 'chèque', especes: 'espèces', 'espèces': 'espèces',
  cb: 'carte bancaire', cb_monetico: 'carte bancaire', prelevement: 'prélèvement',
}

/** Règlement DÉJÀ ENCAISSÉ déclaré à la création (regle_le / regle_par) :
 *  imprime « FACTURE ACQUITTÉE le … par … » au lieu d'un net à payer. */
export function reglementDeclare(
  regleLe: unknown, reglePar: unknown, montantTtc: number,
): { reglement?: Record<string, unknown>; erreur?: string } {
  const date = String(regleLe || '').trim()
  if (!date) return {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { erreur: `regle_le invalide : ${date} (AAAA-MM-JJ attendu)` }
  }
  if (date > new Date().toISOString().slice(0, 10)) {
    return { erreur: `regle_le dans le futur (${date}) : un règlement à venir n'acquitte pas la facture` }
  }
  const par = String(reglePar || 'virement').trim()
  return {
    reglement: {
      acquittee: true, date,
      mode: MODES_REGLEMENT[par.toLowerCase()] || par,
      montant_ttc: arr2(montantTtc),
    },
  }
}

export function conditionsAcquittee(type: string, r: { date?: unknown; mode?: unknown }): string {
  const quand = new Date(String(r.date)).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
  return `${type === 'acompte' ? 'Acompte réglé' : 'Facture réglée'} par ${r.mode} le ${quand}`
}

type Precedent = { rang: number; numero: string | null; date: string | null; ttc: number; id: string }

/** LES ACOMPTES DÉJÀ FACTURÉS sur la même origine (devis ou référence
 *  externe), avant celui qu'on crée : émis ou encore en brouillon (un
 *  brouillon supprimé n'existe plus), sauf ceux annulés par un avoir émis.
 *  Ordre : date du versement, puis date de création. Sans eux le « solde
 *  restant » d'un 2e ou 3e acompte ignorait les précédents (KAB COM00475). */
export async function acomptesPrecedents(
  supabase: SupabaseClient,
  o: { origine: string; environnement: string; dateVente: string; exclure?: string; creeAvant?: string },
): Promise<{ precedents: Precedent[]; deja: number }> {
  if (!o.origine) return { precedents: [], deja: 0 }
  const { data, error } = await supabase
    .from('factures')
    .select('id, numero, statut, date_vente, created_at, total_ttc, mentions, lignes')
    .eq('devis_numero', o.origine)
    .eq('type', 'acompte')
    .eq('environnement', o.environnement)
  if (error) throw new Error(`Lecture des acomptes précédents impossible : ${error.message}`)
  const rows = (data || []).filter((f) => f.id !== o.exclure)
  let annulees = new Set<string>()
  if (rows.length) {
    const { data: av } = await supabase
      .from('factures').select('facture_liee')
      .eq('type', 'avoir').neq('statut', 'brouillon')
      .in('facture_liee', rows.map((f) => f.id))
    annulees = new Set((av || []).map((a) => String(a.facture_liee)))
  }
  const avant = rows
    .filter((f) => !annulees.has(f.id))
    .filter((f) => {
      const d = String(f.date_vente || String(f.created_at).slice(0, 10))
      if (d !== o.dateVente) return d < o.dateVente
      return !o.creeAvant || String(f.created_at) < o.creeAvant
    })
    .sort((a, b) =>
      String(a.date_vente || '').localeCompare(String(b.date_vente || '')) ||
      String(a.created_at).localeCompare(String(b.created_at)))
  const precedents = avant.map((f, i) => {
    const ttc = f.total_ttc != null
      ? Number(f.total_ttc)
      : f.mentions?.acompte?.facture_ttc != null
        ? Number(f.mentions.acompte.facture_ttc)
        : ((f.lignes || []) as Ligne[]).reduce(
            (s, l) => s + (Number(l.quantite) || 1) * Number(l.prix_unitaire_ht) * (1 + Number(l.tva ?? 20) / 100), 0)
    return { rang: i + 1, id: f.id as string, numero: (f.numero as string) || null, date: (f.date_vente as string) || null, ttc: arr2(ttc) }
  })
  return { precedents, deja: arr2(precedents.reduce((s, p) => s + p.ttc, 0)) }
}


export async function creerBrouillonFacture(
  supabase: SupabaseClient,
  body: Record<string, any>,
): Promise<Reponse> {
  const environnement = body.environnement === 'prod' ? 'prod' : 'test'
  // Fourniture seule ou chantier avec pose : la réponse change le vocabulaire
  // ET l'exigibilité du solde. Calculée une fois, utilisée partout.
  let aPoseDevis = false
  const type = ['facture', 'acompte', 'solde', 'avoir'].includes(String(body.type)) ? String(body.type) : 'facture'
  const devisNumero = String(body.devis_numero || '').trim()

  // ---- 1. Le devis, s'il existe en base : il préremplit, il ne contraint pas.
  let devis: Record<string, any> | null = null
  if (devisNumero) {
    const { data } = await supabase
      .from('devis_claudus')
      .select('numero, client_nom, client_civilite, client_adresse, client_cp, client_ville, montant_ht, tva_taux, acompte_pct, conditions_reglement, pose, livraison, lignes')
      .eq('numero', devisNumero)
      .maybeSingle()
    devis = data
    if (!devis) {
      return reponse({ error: `Devis ${devisNumero} introuvable` }, 404)
    }
  }

  // ---- 2. Le client. Ce qui est fourni gagne toujours.
  const c = body.client || {}
  // Client PROFESSIONNEL : SIREN (et TVA intracommunautaire) sont des mentions
  // obligatoires de la facture B2B, et l'émission refuse un pro sans SIREN.
  // Jusqu'ici ils étaient silencieusement retirés ici : aucun brouillon pro
  // (autoliquidation KAB ISOBAT, 21/10/2026) ne pouvait donc être émis.
  const siren = String(c.siren || '').replace(/\s/g, '')
  const tvaIntra = String(c.tva_intra || '').replace(/\s/g, '').toUpperCase()
  const professionnel = c.professionnel === true || !!siren
  let client: {
    nom: string; adresse: string; cp: string; ville: string
    professionnel?: boolean; siren?: string; tva_intra?: string
  } = {
    nom: String(c.nom || [devis?.client_civilite, devis?.client_nom].filter(Boolean).join(' ') || '').trim(),
    adresse: String(c.adresse || devis?.client_adresse || '').trim(),
    cp: String(c.cp || devis?.client_cp || '').trim(),
    ville: String(c.ville || devis?.client_ville || '').trim(),
    ...(professionnel ? { professionnel: true } : {}),
    ...(siren ? { siren } : {}),
    ...(tvaIntra ? { tva_intra: tvaIntra } : {}),
  }
  if (siren && !/^\d{9}$/.test(siren)) {
    return reponse({ error: `SIREN invalide : ${siren} (9 chiffres attendus)` }, 400)
  }
  if (tvaIntra && !/^FR[0-9A-Z]{2}\d{9}$/.test(tvaIntra)) {
    return reponse({ error: `N° de TVA intracommunautaire invalide : ${tvaIntra}` }, 400)
  }
  if (siren && tvaIntra && tvaIntra.slice(4) !== siren) {
    return reponse({ error: `Le n° de TVA ${tvaIntra} ne correspond pas au SIREN ${siren}` }, 400)
  }
  // Un AVOIR reprend le client de la facture qu'il annule : rien à fournir, et
  // rien à valider ici — la branche 'avoir' plus bas écrase ce bloc.
  const manquants = type === 'avoir'
    ? []
    : (['nom', 'adresse', 'cp', 'ville'] as const).filter((k) => !client[k])
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

  aPoseDevis = !!devis?.pose && Object.keys(devis.pose as object).length > 0

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
    // > 0 excluait aussi les remises (lignes à prix négatif, ex. « Remise
    // exceptionnelle -20% » à -523,10 €) : le brouillon perdait la remise du
    // devis sans rien signaler (DC-01059, 08/09/2026). Seules les lignes à
    // prix EXACTEMENT nul (offert/inclus) doivent sauter.
    lignes = (devis.lignes as Record<string, any>[])
      .filter((l) => Number(l.prix_unitaire_ht) !== 0)
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
  let avoirDe: { id: string; numero: string; devis_numero: string; categorie: string; motif_tva_zero: string } | null = null
  if (type === 'acompte') {
    if (!(pct > 0 && pct < 100)) {
      return reponse({ error: 'Un acompte demande un pourcentage entre 1 et 99' }, 400)
    }
    const arr = (n: number) => Math.round(n * 100) / 100
    const baseHt = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht, 0)
    const baseTtc = lignes.reduce(
      (s, l) => s + l.quantite * l.prix_unitaire_ht * (1 + Number(l.tva) / 100), 0)

    // UN ACOMPTE SE VENTILE PAR TAUX DE TVA. Un devis fourniture + pose porte
    // deux taux (20 % et 10 %) : taxer tout l'acompte au premier taux rencontré
    // fausse la TVA déclarée ET la déduction au solde, sans que rien ne le
    // signale. On produit donc une ligne d'acompte PAR TAUX, au prorata.
    const parTaux = new Map<number, number>()
    for (const l of lignes) {
      const t = Number(l.tva ?? 20)
      parTaux.set(t, (parTaux.get(t) || 0) + l.quantite * l.prix_unitaire_ht)
    }
    const taux = [...parTaux.keys()].sort((a, b) => b - a)
    const plusieursTaux = taux.length > 1
    const montant = arr((baseHt * pct) / 100)
    if (!(montant > 0)) {
      return reponse({ error: 'Montant HT introuvable pour calculer l’acompte' }, 400)
    }

    const arrondi = arr
    const acompteTtc = arr(
      taux.reduce((s, t) => s + ((parTaux.get(t) as number) * pct) / 100 * (1 + t / 100), 0))
    // QUAND LE SOLDE EST-IL DÛ ? Trois cas, et ils ne se disent pas pareil :
    //  - chantier (pose) : à l'achèvement des travaux ;
    //  - fourniture livrée : AVANT la livraison — la marchandise ne part pas
    //    d'un entrepôt sans être soldée ;
    //  - fourniture retirée sur place : au retrait de la marchandise.
    // Écrire « à la livraison » quand il n'y a pas de livraison, ou quand le
    // solde est en réalité exigible avant, engage l'entreprise à tort.
    // DÉFAUT = AVEC LIVRAISON (règle du gérant, 29/08/2026). Le retrait en
    // dépôt est l'exception et doit être DEMANDÉ explicitement : déduire
    // « retrait » de l'absence de bloc livraison sur le devis serait faux —
    // beaucoup de devis anciens n'ont simplement pas ce bloc, alors que la
    // marchandise a bien été livrée.
    const retraitDemande = body.retrait === true || String(body.remise || '') === 'retrait'
    const chantier = estChantier({
      aPoseDevis, categorie: body.categorie_operation, autoliquidation: body.autoliquidation === true,
      motifTvaZero: body.motif_tva_zero, lignes,
    })
    const remise = chantier ? 'chantier' : retraitDemande ? 'retrait' : 'livraison'

    // Les acomptes DÉJÀ facturés sur la même origine : ils fixent le rang
    // (« Acompte n° 2 ») et se déduisent du reste dû.
    const origine = devisNumero || String(body.reference_externe || '').trim()
    let prec: Awaited<ReturnType<typeof acomptesPrecedents>>
    try {
      prec = await acomptesPrecedents(supabase, {
        origine, environnement,
        dateVente: String(body.date_vente || new Date().toISOString().slice(0, 10)),
      })
    } catch (e) {
      return reponse({ error: e instanceof Error ? e.message : String(e) }, 500)
    }
    const rang = prec.precedents.length + 1
    const resteTtc = arrondi(baseTtc - prec.deja - acompteTtc)
    if (resteTtc < -0.01) {
      return reponse({
        error: `Acompte n° ${rang} : ${acompteTtc} € + ${prec.deja} € déjà facturés dépassent la commande (${arrondi(baseTtc)} € TTC)`,
      }, 400)
    }

    mentions = {
      acompte: {
        pct,
        remise,
        devis: devisNumero || null,
        commande_ht: arrondi(baseHt),
        commande_ttc: arrondi(baseTtc),
        facture_ttc: acompteTtc,
        rang,
        precedents: prec.precedents.map(({ rang: r, numero, date, ttc }) => ({ rang: r, numero, date, ttc })),
        deja_facture_ttc: prec.deja,
        reste_ttc: resteTtc,
      },
    }

    // FACTURE ACQUITTÉE : un acompte est presque toujours facturé APRÈS
    // encaissement (c'est l'encaissement qui rend la TVA exigible, art. 269-2-c
    // CGI). Le document doit donc dire qu'il est payé et afficher un net à
    // payer nul — sans quoi le client lit « TOTAL TTC 601,50 € » comme une
    // somme réclamée. C'est aussi sa preuve de paiement.
    const regl = reglementDeclare(body.regle_le, body.regle_par, acompteTtc)
    if (regl.erreur) return reponse({ error: regl.erreur }, 400)
    if (regl.reglement) mentions.reglement = regl.reglement

    // La désignation doit IDENTIFIER LE PRODUIT, pas seulement le pourcentage :
    // « Acompte 50 % sur devis DC-00925 » ne dit pas ce qui est vendu.
    // CE QUI IDENTIFIE le produit, PAS la fiche technique du fabricant : le
    // devis reste LE document technique, et chaque ligne recopiée est une
    // occasion de le contredire (« 600 Nm » au lieu de 600 N, « Lisse Lisse »).
    const IDENTIFIANT = /dimension|cote|largeur|hauteur|coloris|couleur|RAL|motoris|moteur|t[ée]l[ée]commande|manœuvre|manoeuvre|type de|vitrage|lame|remplissage|pose/i
    const descriptif = lignes
      .map((l) => {
        const q = l.quantite > 1 ? ` (× ${l.quantite})` : ''
        const utiles = String(l.details || '')
          .split('\n')
          .filter((d) => IDENTIFIANT.test(d))
          // Les devis déjà enregistrés portent les scories du libellé
          // fournisseur : sur une facture, un mot doublé se lit comme une faute.
          .map((d) => d.split(/\s+/)
            .filter((mot, i, t) => mot.toLowerCase() !== (t[i - 1] || '').toLowerCase())
            .join(' '))
        return `— ${l.designation}${q}` + (utiles.length ? `\n${utiles.join('\n')}` : '')
      })
      .join('\n')

    const objets = lignes.map((l) => l.designation).filter(Boolean)
    const resume = objets.length > 2
      ? `${objets.slice(0, 2).join(', ')} et ${objets.length - 2} autre(s) poste(s)`
      : objets.join(' et ')
    const intitule = intituleAcompte(rang, pct, resume, devisNumero)
    lignes = taux.map((t, i) => ({
      designation: plusieursTaux ? `${intitule} — part TVA ${t} %` : intitule,
      // Le descriptif ne se répète pas : il porte sur la commande entière.
      ...(i === 0 ? { details: descriptif } : {}),
      quantite: 1,
      prix_unitaire_ht: arr(((parTaux.get(t) as number) * pct) / 100),
      tva: t,
    }))
  }

  // AVOIR : le SEUL moyen d'annuler une facture émise (elle est numérotée,
  // chaînée et comptabilisée — on ne la modifie ni ne la supprime). Il reprend
  // les lignes de la facture annulée en NÉGATIF et la référence explicitement.
  // Le client ne le reçoit que s'il avait reçu la facture d'origine ; sinon
  // c'est une pièce interne qui solde le numéro consommé.
  if (type === 'avoir') {
    const ref = String(body.facture_annulee || '').trim()
    if (!ref) {
      return reponse({ error: 'Un avoir doit désigner la facture annulée (facture_annulee)' }, 400)
    }
    const { data: origine } = await supabase
      .from('factures')
      .select('id, numero, type, client, devis_numero, categorie_operation, lignes, emise_le, statut, motif_tva_zero')
      .eq('numero', ref)
      .eq('environnement', environnement)
      .maybeSingle()
    if (!origine) return reponse({ error: `Facture ${ref} introuvable` }, 404)
    if (origine.statut !== 'emise') {
      return reponse({ error: `${ref} n'est pas émise : un brouillon se supprime, il ne s'annule pas` }, 400)
    }
    const { data: dejaAnnulee } = await supabase
      .from('factures')
      .select('numero').eq('type', 'avoir').eq('facture_liee', origine.id)
      .eq('statut', 'emise').maybeSingle()
    if (dejaAnnulee) {
      return reponse({ error: `${ref} est déjà annulée par l'avoir ${dejaAnnulee.numero}` }, 409)
    }

    lignes = ((origine.lignes || []) as Ligne[]).map((l) => ({
      designation: l.designation,
      details: l.details,
      quantite: Number(l.quantite) || 1,
      // POSITIF : dans ce moteur, un avoir porte les MÊMES montants que la
      // facture qu'il annule — sa nature de note de crédit vient du type et de
      // la série AV. Des lignes négatives donnent un total TTC négatif, que
      // `facture_emettre` refuse (et il a raison : c'est sa règle).
      prix_unitaire_ht: Math.abs(Number(l.prix_unitaire_ht) || 0),
      tva: Number(l.tva ?? 20),
    }))
    if (!lignes.length) return reponse({ error: `${ref} n'a aucune ligne à annuler` }, 400)

    // Tout est repris de la facture annulée : mêmes client, même rattachement,
    // même catégorie. Un avoir qui divergerait de son original ne prouverait
    // plus qu'il l'annule.
    client = (origine.client || {}) as typeof client
    avoirDe = {
      id: origine.id as string,
      numero: origine.numero as string,
      devis_numero: (origine.devis_numero as string) || '',
      categorie: (origine.categorie_operation as string) || '',
      // Un avoir d'une facture autoliquidée reste à TVA 0 : même justification.
      motif_tva_zero: (origine.motif_tva_zero as string) || '',
    }
    mentions = { avoir: { annule: origine.numero, emise_le: origine.emise_le } }
  }

  // FACTURE DE SOLDE : elle reprend la commande ENTIÈRE puis DÉDUIT les acomptes
  // déjà facturés, en référençant leur numéro (BOFiP BOI-TVA-DECLA-30-20-20-10).
  // Sans cette déduction le client serait facturé deux fois et la TVA payée deux
  // fois : le type 'solde' n'était jusqu'ici qu'une étiquette.
  if (type === 'solde' && devisNumero) {
    const { data: acomptes } = await supabase
      .from('factures')
      .select('numero, emise_le, lignes')
      .eq('devis_numero', devisNumero)
      .eq('type', 'acompte')
      .eq('statut', 'emise')
      .eq('environnement', environnement)
      .order('emise_le', { ascending: true })

    for (const a of acomptes || []) {
      for (const l of (a.lignes || []) as Ligne[]) {
        const ht = (Number(l.quantite) || 1) * (Number(l.prix_unitaire_ht) || 0)
        if (!ht) continue
        lignes.push({
          designation: `Acompte déjà facturé — ${a.numero}` +
            `${a.emise_le ? ` du ${new Date(a.emise_le).toLocaleDateString('fr-FR')}` : ''}`,
          quantite: 1,
          prix_unitaire_ht: -Math.round(ht * 100) / 100,
          tva: Number(l.tva ?? 20),
        })
      }
    }
    if (!(acomptes || []).length) {
      // Silence dangereux évité : facturer un « solde » sans acompte trouvé
      // reviendrait à refacturer la commande entière sous un titre trompeur.
      return reponse(
        { error: `Aucune facture d'acompte émise pour ${devisNumero} : ce n'est pas un solde, mais une facture.` },
        400,
      )
    }
  }

  if (!lignes.length) {
    return reponse({ error: 'Aucune ligne à facturer' }, 400)
  }
  const tvaInvalide = lignes.find((l) => !TVA_ADMISES.includes(Number(l.tva)))
  if (tvaInvalide) {
    return reponse({ error: `Taux de TVA non conforme : ${tvaInvalide.tva}` },
      400)
  }

  // TVA 0 % : le moteur d'émission exige le texte légal qui la justifie
  // (motif_tva_zero), mais rien ne permettait de le fournir — le brouillon se
  // créait, puis l'émission échouait. On l'exige ici, quand l'erreur se
  // corrige encore sans rien défaire.
  // AUTOLIQUIDATION (sous-traitance de travaux immobiliers, art. 283-2 nonies
  // CGI) : la TVA est due par le preneur, assujetti identifié par son SIREN.
  // `autoliquidation: true` pose la mention légale et exige ce SIREN.
  const autoliquidation = body.autoliquidation === true
  let motifTvaZero = avoirDe ? avoirDe.motif_tva_zero : String(body.motif_tva_zero || '').trim()
  if (autoliquidation && !avoirDe) {
    if (!client.siren) {
      return reponse({ error: 'Autoliquidation : SIREN du client obligatoire (preneur assujetti)' }, 400)
    }
    const taxee = lignes.find((l) => Number(l.tva) !== 0)
    if (taxee) {
      return reponse({
        error: `Autoliquidation : toutes les lignes doivent être à TVA 0 (« ${taxee.designation} » à ${taxee.tva} %)`,
      }, 400)
    }
    motifTvaZero = motifTvaZero || MOTIF_AUTOLIQUIDATION
  }
  if (lignes.some((l) => Number(l.tva) === 0) && !motifTvaZero) {
    return reponse({
      error: 'Ligne à TVA 0 % : motif_tva_zero obligatoire',
      aide: 'Passe autoliquidation: true (sous-traitance BTP, SIREN requis) ou le texte légal dans motif_tva_zero.',
    }, 400)
  }

  // FACTURE DÉJÀ RÉGLÉE (petite facture soldée, encaissement antérieur) :
  // même mécanique que l'acompte — « FACTURE ACQUITTÉE le … par … ».
  if (type !== 'acompte' && type !== 'avoir' && body.regle_le) {
    const ttc = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht * (1 + Number(l.tva) / 100), 0)
    const regl = reglementDeclare(body.regle_le, body.regle_par, ttc)
    if (regl.erreur) return reponse({ error: regl.erreur }, 400)
    if (regl.reglement) mentions = { ...(mentions || {}), reglement: regl.reglement }
  }

  const aujourdhui = new Date().toISOString().slice(0, 10)
  const aPose = aPoseDevis

  const payload = {
    environnement,
    type,
    // Le lien vers l'origine, quelle qu'elle soit : un devis maison ou une
    // référence externe (ProDevis). Sans lui, la facture est orpheline et le
    // rapprochement avec l'encaissement devient une enquête.
    devis_numero: avoirDe?.devis_numero || devisNumero || String(body.reference_externe || '').trim() || null,
    categorie_operation: avoirDe?.categorie || body.categorie_operation || (aPose ? 'mixte' : 'biens'),
    ...(avoirDe
      ? {
          facture_liee: avoirDe.id,
          motif: String(body.motif || `Annulation de la facture ${avoirDe.numero}`),
        }
      : {}),
    client,
    // Souvent différente de l'adresse de facturation (copropriété, chantier
    // pro) — à fournir explicitement, { nom?, adresse, cp, ville }. Pas de
    // dérivation depuis le devis : sa forme varie trop d'une source à l'autre
    // pour être devinée sans risque.
    ...(body.adresse_livraison ? { adresse_livraison: body.adresse_livraison } : {}),
    lignes,
    ...(motifTvaZero ? { motif_tva_zero: motifTvaZero } : {}),
    date_vente: String(body.date_vente || aujourdhui),
    date_echeance: String(body.date_echeance || aujourdhui),
    // « Paiement à réception de facture » sur une facture DÉJÀ RÉGLÉE est une
    // absurdité qui contredit la mention ACQUITTÉE deux lignes plus bas : le
    // défaut ne doit s'appliquer qu'à ce qui reste dû.
    conditions_reglement: avoirDe
      ? `Annule et remplace la facture ${avoirDe.numero}`
      : mentions?.reglement
        ? conditionsAcquittee(type, mentions.reglement)
        : body.conditions_reglement || devis?.conditions_reglement || 'Paiement à réception de facture',
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
  }, 200)
}

/**
 * REFAIRE UN BROUILLON avec les règles actuelles (rang et solde des acomptes,
 * formule du solde, mention ACQUITTÉE), sans rien perdre de ce qu'il porte.
 *
 * POURQUOI : un brouillon d'acompte ne garde pas les lignes de la commande
 * (seulement l'avance et son descriptif) — on ne peut donc pas le recréer par
 * `creerBrouillonFacture`. Ici, montants, client, dates et descriptif sont
 * repris À L'IDENTIQUE ; seuls l'intitulé, le récapitulatif (`mentions`) et
 * les conditions de règlement sont recalculés. Le nouveau brouillon est créé
 * À CÔTÉ de l'ancien : l'appelant vérifie le PDF, PUIS supprime l'ancien —
 * l'ancien est exclu du calcul des acomptes précédents.
 */
export async function refaireBrouillonFacture(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Reponse> {
  const id = String(body.facture_id || '').trim()
  if (!id) return reponse({ error: 'facture_id requis' }, 400)
  const { data: f, error } = await supabase.from('factures').select('*').eq('id', id).maybeSingle()
  if (error) return reponse({ error: error.message }, 500)
  if (!f) return reponse({ error: `Brouillon ${id} introuvable` }, 404)
  if (f.statut !== 'brouillon') {
    return reponse({ error: `${f.numero || id} est émise : elle ne se refait pas (avoir)` }, 400)
  }
  if (!['facture', 'acompte', 'solde'].includes(f.type)) {
    return reponse({ error: `Type ${f.type} : non pris en charge` }, 400)
  }

  let lignes = ((f.lignes || []) as Ligne[]).map((l) => ({ ...l }))
  type Recap = Record<string, unknown> & { pct?: number; commande_ttc?: number; facture_ttc?: number; remise?: string; rang?: number; reste_ttc?: number }
  const mentions: { acompte?: Recap; reglement?: Record<string, unknown>; [k: string]: unknown } = { ...(f.mentions || {}) }
  const ttcLignes = lignes.reduce(
    (s, l) => s + (Number(l.quantite) || 1) * Number(l.prix_unitaire_ht) * (1 + Number(l.tva ?? 20) / 100), 0)

  if (f.type === 'acompte') {
    const a = { ...(mentions.acompte || {}) }
    if (!a.commande_ttc) return reponse({ error: 'Acompte sans récapitulatif de commande (mentions.acompte)' }, 400)
    let prec: Awaited<ReturnType<typeof acomptesPrecedents>>
    try {
      prec = await acomptesPrecedents(supabase, {
        origine: String(f.devis_numero || ''), environnement: f.environnement,
        dateVente: String(f.date_vente || String(f.created_at).slice(0, 10)),
        exclure: f.id, creeAvant: f.created_at,
      })
    } catch (e) {
      return reponse({ error: e instanceof Error ? e.message : String(e) }, 500)
    }
    const rang = prec.precedents.length + 1
    const factureTtc = arr2(Number(a.facture_ttc ?? ttcLignes))
    const reste = arr2(Number(a.commande_ttc) - prec.deja - factureTtc)
    if (reste < -0.01) {
      return reponse({ error: `Acompte n° ${rang} : le cumul des acomptes dépasse la commande (${a.commande_ttc} € TTC)` }, 400)
    }
    const chantier = a.remise === 'chantier' || estChantier({
      categorie: f.categorie_operation, motifTvaZero: f.motif_tva_zero, lignes,
    })
    a.remise = chantier ? 'chantier' : a.remise === 'retrait' ? 'retrait' : 'livraison'
    a.rang = rang
    a.precedents = prec.precedents.map(({ rang: r, numero, date, ttc }) => ({ rang: r, numero, date, ttc }))
    a.deja_facture_ttc = prec.deja
    a.facture_ttc = factureTtc
    a.reste_ttc = reste
    mentions.acompte = a
    // L'intitulé suit le rang ; le pourcentage s'écrit à la française.
    const PREFIXE = /^Acompte(?: n° \d+)?(?: de)? [\d.,]+ ?%/
    lignes = lignes.map((l) => ({
      ...l,
      designation: PREFIXE.test(l.designation)
        ? l.designation.replace(PREFIXE, `Acompte n° ${rang} de ${pctFr(Number(a.pct))} %`)
        : l.designation,
    }))
  }

  if (body.regle_le) {
    const montant = f.type === 'acompte' ? Number(mentions.acompte?.facture_ttc) : ttcLignes
    const regl = reglementDeclare(body.regle_le, body.regle_par, montant)
    if (regl.erreur) return reponse({ error: regl.erreur }, 400)
    mentions.reglement = regl.reglement
  }

  const payload = {
    environnement: f.environnement,
    type: f.type,
    devis_numero: f.devis_numero,
    categorie_operation: f.categorie_operation,
    ...(f.facture_liee ? { facture_liee: f.facture_liee } : {}),
    ...(f.motif ? { motif: f.motif } : {}),
    client: f.client,
    ...(f.adresse_livraison ? { adresse_livraison: f.adresse_livraison } : {}),
    lignes,
    ...(f.motif_tva_zero ? { motif_tva_zero: f.motif_tva_zero } : {}),
    date_vente: f.date_vente,
    date_echeance: f.date_echeance,
    conditions_reglement: mentions.reglement
      ? conditionsAcquittee(f.type, mentions.reglement)
      : f.conditions_reglement,
    ...(Object.keys(mentions).length ? { mentions } : {}),
  }
  const { data: nouveau, error: eRpc } = await supabase.rpc('facture_creer_brouillon', {
    payload, acteur: String(body.acteur || 'CRM'),
  })
  if (eRpc) return reponse({ error: eRpc.message }, 500)
  return reponse({
    ok: true,
    facture_id: nouveau,
    remplace: f.id,
    type: f.type,
    environnement: f.environnement,
    origine: f.devis_numero,
    ...(f.type === 'acompte'
      ? { rang: mentions.acompte?.rang, reste_ttc: mentions.acompte?.reste_ttc, remise: mentions.acompte?.remise }
      : {}),
    acquittee: !!mentions.reglement,
    message: "Nouveau brouillon créé à côté de l'ancien : vérifie son PDF, PUIS supprime l'ancien.",
  }, 200)
}
