import type { SupabaseClient } from '@supabase/supabase-js'
import { creerBrouillonFacture } from './factures-creer'

/**
 * PROFORMA — l'appel de fonds, et surtout PAS une facture.
 *
 * POURQUOI : une facture définitive ne peut pas être émise avant la livraison
 * (BOI-TVA-DECLA-30-20-10 : elle s'émet dès la réalisation). Or l'entreprise
 * encaisse le solde AVANT de livrer. La proforma demande ce règlement sans rien
 * engager : aucun numéro de facture consommé, aucune écriture, aucune TVA
 * exigible. Si le client ne paie pas, on la supprime — il n'y a ni facture à
 * annuler ni avoir à établir.
 *
 * Quand le virement arrive, la proforma se CONVERTIT en facture d'acompte
 * (c'est l'encaissement qui rend la TVA exigible, art. 269-2° CGI) — via le
 * MÊME chemin de création que toutes les autres factures, jamais un second.
 */

type Reponse = { status: number; corps: Record<string, unknown> }
const reponse = (corps: Record<string, unknown>, status = 200): Reponse => ({ status, corps })

const TVA_ADMISES = [0, 5.5, 10, 20]

/** Crée une proforma. Les lignes viennent d'un devis, ou sont fournies. */
export async function creerProforma(
  supabase: SupabaseClient,
  body: Record<string, any>,
): Promise<Reponse> {
  const environnement = body.environnement === 'prod' ? 'prod' : 'test'
  const devisNumero = String(body.devis_numero || '').trim()

  let devis: Record<string, any> | null = null
  if (devisNumero) {
    const { data } = await supabase
      .from('devis_claudus')
      .select('numero, client_nom, client_civilite, client_adresse, client_cp, client_ville, montant_ht, tva_taux, pose, livraison, lignes')
      .eq('numero', devisNumero)
      .maybeSingle()
    devis = data
    if (!devis) return reponse({ error: `Devis ${devisNumero} introuvable` }, 404)
  }

  const c = (body.client || {}) as Record<string, string>
  const client = {
    nom: String(c.nom || [devis?.client_civilite, devis?.client_nom].filter(Boolean).join(' ') || '').trim(),
    adresse: String(c.adresse || devis?.client_adresse || '').trim(),
    cp: String(c.cp || devis?.client_cp || '').trim(),
    ville: String(c.ville || devis?.client_ville || '').trim(),
  }
  const manquants = (['nom', 'adresse', 'cp', 'ville'] as const).filter((k) => !client[k])
  if (manquants.length) {
    return reponse({ error: `Coordonnées client incomplètes : ${manquants.join(', ')}` }, 400)
  }

  // Les lignes : celles fournies, sinon le devis entier, sinon un appel de fonds
  // exprimé en pourcentage du devis.
  let lignes: Record<string, any>[] = []
  if (Array.isArray(body.lignes) && body.lignes.length) {
    lignes = body.lignes.map((l: Record<string, any>) => ({
      designation: String(l.designation || '').trim(),
      details: l.details ? String(l.details) : undefined,
      quantite: Number(l.quantite) || 1,
      prix_unitaire_ht: Number(l.prix_unitaire_ht),
      tva: Number(l.tva ?? devis?.tva_taux ?? 20),
    }))
  } else if (devis) {
    lignes = ((devis.lignes || []) as Record<string, any>[]).map((l) => ({
      designation: String(l.designation || 'Prestation'),
      details: l.details ? String(l.details) : undefined,
      quantite: Number(l.quantite) || 1,
      prix_unitaire_ht: Number(l.prix_unitaire_ht),
      tva: Number(l.tva ?? devis?.tva_taux ?? 20),
    }))
  }
  if (!lignes.length) return reponse({ error: 'Aucune ligne : fournis `lignes` ou un `devis_numero`' }, 400)

  const invalide = lignes.find((l) => !l.designation || !Number.isFinite(l.prix_unitaire_ht) || !TVA_ADMISES.includes(Number(l.tva)))
  if (invalide) {
    return reponse({ error: `Ligne invalide (désignation, prix ou taux) : ${invalide.designation || '—'}` }, 400)
  }

  // Appel de fonds partiel : on ne recopie pas la commande, on demande un
  // pourcentage — ventilé PAR TAUX, comme un acompte (une proforma à taux
  // unique sur une commande mixte donnerait un montant juste et une TVA fausse).
  const pct = Number(body.pourcentage ?? 0)
  let mentions: Record<string, any> | null = null
  if (pct > 0 && pct < 100) {
    const arr = (n: number) => Math.round(n * 100) / 100
    const parTaux = new Map<number, number>()
    for (const l of lignes) {
      const t = Number(l.tva)
      parTaux.set(t, (parTaux.get(t) || 0) + l.quantite * l.prix_unitaire_ht)
    }
    const baseHt = [...parTaux.values()].reduce((s, b) => s + b, 0)
    const baseTtc = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht * (1 + Number(l.tva) / 100), 0)
    const taux = [...parTaux.keys()].sort((a, b) => b - a)
    const objets = lignes.map((l) => l.designation).filter(Boolean)
    const resume = objets.length > 2 ? `${objets.slice(0, 2).join(', ')} et ${objets.length - 2} autre(s) poste(s)` : objets.join(' et ')
    const intitule = `Appel de fonds ${pct} % sur ${resume || 'la commande'}` +
      `${devisNumero ? `, selon devis ${devisNumero} accepté` : ''}`
    const demandeTtc = arr(taux.reduce((s, t) => s + ((parTaux.get(t) as number) * pct) / 100 * (1 + t / 100), 0))

    mentions = {
      appel: {
        pct,
        devis: devisNumero || null,
        commande_ht: arr(baseHt),
        commande_ttc: arr(baseTtc),
        demande_ttc: demandeTtc,
        reste_ttc: arr(baseTtc - demandeTtc),
      },
    }
    lignes = taux.map((t) => ({
      designation: taux.length > 1 ? `${intitule} — part TVA ${t} %` : intitule,
      quantite: 1,
      prix_unitaire_ht: arr(((parTaux.get(t) as number) * pct) / 100),
      tva: t,
    }))
  }

  const aPose = !!devis?.pose && Object.keys(devis.pose as object).length > 0
  const { data: id, error } = await supabase.rpc('proforma_creer', {
    payload: {
      environnement,
      client,
      devis_numero: devisNumero || String(body.reference_externe || '').trim() || null,
      categorie_operation: body.categorie_operation || (aPose ? 'mixte' : 'biens'),
      lignes,
      conditions_reglement: body.conditions_reglement || 'Règlement par virement avant expédition ou retrait de la marchandise.',
      validite_jours: Number(body.validite_jours) || 30,
      mentions,
    },
    acteur: String(body.acteur || 'CRM'),
  })
  if (error) return reponse({ error: error.message }, 500)

  const { data: pf } = await supabase
    .from('proformas')
    .select('numero, total_ht, total_ttc')
    .eq('id', id)
    .maybeSingle()

  return reponse({
    ok: true,
    proforma_id: id,
    numero: pf?.numero,
    total_ht: pf?.total_ht,
    total_ttc: pf?.total_ttc,
    message: "Proforma créée. Ce n'est PAS une facture : aucun numéro de facture consommé, aucune TVA exigible. À convertir en facture d'acompte une fois le règlement encaissé.",
  })
}

/**
 * Convertit une proforma en FACTURE D'ACOMPTE, une fois le règlement reçu.
 * C'est l'encaissement qui déclenche l'obligation de facturer — pas l'envoi de
 * la proforma. La facture naît en BROUILLON : l'émission reste un geste humain.
 */
export async function convertirProforma(
  supabase: SupabaseClient,
  body: Record<string, any>,
): Promise<Reponse> {
  const ref = String(body.numero || '').trim()
  if (!ref) return reponse({ error: 'numero de proforma requis' }, 400)

  const { data: pf } = await supabase
    .from('proformas')
    .select('*')
    .eq('numero', ref)
    .maybeSingle()
  if (!pf) return reponse({ error: `Proforma ${ref} introuvable` }, 404)
  if (pf.statut === 'convertie') {
    const { data: deja } = await supabase
      .from('factures').select('numero, statut').eq('id', pf.facture_id).maybeSingle()
    return reponse({
      error: `${ref} a déjà donné la facture ${deja?.numero || '(brouillon)'} — une proforma ne se facture qu'une fois`,
    }, 409)
  }
  if (pf.statut === 'annulee') return reponse({ error: `${ref} est annulée` }, 409)

  const regleLe = String(body.regle_le || new Date().toISOString().slice(0, 10))

  // ACOMPTE OU FACTURE ? Un règlement encaissé AVANT la livraison est un
  // acompte, quel qu'en soit le montant (art. 269-2° CGI). Une proforma qui
  // appelait un pourcentage donne donc une facture d'ACOMPTE, reconstruite par
  // le chemin normal depuis le devis — elle y gagne son descriptif, son
  // récapitulatif et sa ventilation. Une proforma portant des lignes propres
  // (marchandise remise au paiement) donne une facture ordinaire.
  const pct = Number(pf.mentions?.appel?.pct || 0)
  const enAcompte = pct > 0 && pct < 100 && !!pf.devis_numero
  const { status, corps } = await creerBrouillonFacture(supabase, {
    environnement: pf.environnement,
    type: body.type_facture || (enAcompte ? 'acompte' : 'facture'),
    ...(enAcompte ? { acompte_pct: pct } : { lignes: pf.lignes }),
    devis_numero: pf.devis_numero || '',
    categorie_operation: pf.categorie_operation || undefined,
    client: pf.client,
    regle_le: regleLe,
    regle_par: body.regle_par || 'virement',
    acteur: String(body.acteur || 'CRM'),
  })
  if (status >= 400) return { status, corps }

  await supabase
    .from('proformas')
    .update({ statut: 'convertie', facture_id: (corps as Record<string, any>).facture_id, convertie_le: new Date().toISOString() })
    .eq('id', pf.id)

  return reponse({ ...corps, proforma: ref, message: `Brouillon de facture créé depuis ${ref}. Il reste à émettre.` })
}
