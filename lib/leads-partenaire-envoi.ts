import nodemailer from 'nodemailer'
import { createAdminClient } from '@/lib/supabase'

/**
 * ENVOI DU DEVIS AU CLIENT (lead partenaire) — fonction UNIQUE, partagée entre
 * le bouton manuel de /leads-partenaire et un futur déclenchement automatique
 * depuis la veille (VPS). Une seule logique d'envoi, jamais deux qui divergent.
 *
 * PAS D'AUTOMATISATION ARMÉE POUR L'INSTANT (décision gérant 02/09/2026) :
 * cette fonction n'est appelée que depuis le bouton "Envoyer" de la page CRM.
 * Rien ne l'appelle tout seul.
 *
 * Catalogue joint UNIQUEMENT pour les portes sectionnelles (le catalogue
 * latérale n'existe pas encore — le gérant est en train de le préparer). Table
 * volontairement extensible : ajouter une ligne suffira le jour où il arrive.
 */
const CATALOGUES: Record<string, string> = {
  'Porte de garage sectionnelle': 'porte-garage-sectionnelle.pdf',
}

// Coordonnées OFFICIELLES — le même bloc que le pied de page de chaque devis
// PDF (VPS : ~/.hermes/pdf/config/entreprise.json). Un client qui rappelle
// doit tomber sur le fixe de l'entreprise, pas sur un numéro de template.
const ENTREPRISE = {
  nom: 'Renov-R',
  adresse: '25 route de Fontenay',
  cp_ville: '91610 Ballancourt-sur-Essonne',
  telephone: '01 79 72 52 25',
  email: 'contact@renov-r.com',
  site: 'www.renov-r.com',
}

function eur(v: number | null | undefined) {
  const n = Number(v || 0)
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

/** « David Ramakers (Palmyre Renove EURL) » -> « David Ramakers » : la
 *  parenthèse du partenaire (société) n'a rien à faire dans un « Bonjour ». */
function nomAffiche(nom: string | null) {
  const n = String(nom || '').replace(/\s*\(.*?\)\s*$/, '').trim()
  return n || 'Madame, Monsieur'
}

/** « Porte de garage sectionnelle » -> « porte de garage sectionnelle ». */
function produitAffiche(reference: string | null) {
  const r = String(reference || '').trim()
  return r ? r.charAt(0).toLowerCase() + r.slice(1) : 'projet'
}

interface Contenu {
  nom: string
  numero: string
  produit: string
  montantTtc: number | null
  avecCatalogue: boolean
}

function emailTexte(c: Contenu) {
  const montant = c.montantTtc != null ? ` : ${eur(c.montantTtc)} TTC` : ''
  return [
    `Bonjour ${c.nom},`,
    '',
    `Merci pour votre demande. Voici votre devis ${c.numero} pour votre ${c.produit}${montant}, en pièce jointe.`,
    ...(c.avecCatalogue
      ? ['', 'Nous y avons ajouté notre catalogue de portes sectionnelles, pour choisir finitions et coloris en toute tranquillité.']
      : []),
    '',
    `Une question, une cote à vérifier ? Répondez à cet e-mail ou appelez-nous au ${ENTREPRISE.telephone} : nous vous accompagnons pour la suite.`,
    '',
    'Bien cordialement,',
    `L'équipe ${ENTREPRISE.nom}`,
    '',
    `${ENTREPRISE.nom} — ${ENTREPRISE.adresse}, ${ENTREPRISE.cp_ville}`,
    `Tél. ${ENTREPRISE.telephone} · ${ENTREPRISE.email} · ${ENTREPRISE.site}`,
  ].join('\n')
}

// Charte NOIR + DORÉ (pas le rouge du site) : même identité que les documents
// DocuSeal (logo extrait d'un mail de signature réel, 02/09/2026). Le logo est
// servi en dur depuis le CRM (public/images/) — jamais depuis DocuSeal, dont
// l'URL n'est pas censée être stable dans le temps.
const OR = '#D4AF37'
const OR_CLAIR = '#E8CE7A'

function logoUrl() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  return `${base}/images/renov-r-logo-noir-dore.jpg`
}

function emailHtml(c: Contenu) {
  const montant = c.montantTtc != null ? ` : <strong>${eur(c.montantTtc)} TTC</strong>` : ''
  const p = (txt: string, dernier = false) =>
    `<p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 ${dernier ? 0 : 16}px;">${txt}</p>`
  return `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    <div style="background: #0a0a0a; padding: 24px; text-align: center;">
      <img src="${logoUrl()}" alt="Renov-R" width="72" height="72" style="display: block; margin: 0 auto 12px; border-radius: 8px;" />
      <p style="color: ${OR_CLAIR}; margin: 0; font-size: 14px; letter-spacing: 0.02em;">Votre devis ${c.numero}</p>
    </div>
    <div style="height: 3px; background: linear-gradient(90deg, ${OR}, ${OR_CLAIR}, ${OR});"></div>
    <div style="padding: 28px 24px;">
      <p style="font-size: 16px; color: #0a0a0a; margin: 0 0 16px;">Bonjour ${c.nom},</p>
      ${p(`Merci pour votre demande. Voici votre devis <strong>${c.numero}</strong> pour votre ${c.produit}${montant}, en pièce jointe.`)}
      ${c.avecCatalogue ? p('Nous y avons ajouté notre catalogue de portes sectionnelles, pour choisir finitions et coloris en toute tranquillité.') : ''}
      ${p(`Une question, une cote à vérifier ? Répondez à cet e-mail ou appelez-nous au <strong>${ENTREPRISE.telephone}</strong> : nous vous accompagnons pour la suite.`)}
      ${p(`Bien cordialement,<br>L'équipe ${ENTREPRISE.nom}`, true)}
    </div>
    <div style="background: #0a0a0a; padding: 18px 24px; border-top: 2px solid ${OR};">
      <p style="font-size: 12px; color: #cbd5e1; margin: 0; text-align: center; line-height: 1.7;">
        <strong style="color: ${OR_CLAIR};">${ENTREPRISE.nom}</strong> — ${ENTREPRISE.adresse}, ${ENTREPRISE.cp_ville}<br>
        Tél. ${ENTREPRISE.telephone} · <a href="mailto:${ENTREPRISE.email}" style="color: #cbd5e1;">${ENTREPRISE.email}</a> · <a href="https://${ENTREPRISE.site}" style="color: #cbd5e1;">${ENTREPRISE.site}</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

export interface EnvoiResultat {
  ok: boolean
  erreur?: string
  destinataire?: string
  sujet?: string
  avec_catalogue?: boolean
}

/**
 * Construit tout ce qu'il faut pour l'envoi (destinataire, sujet, HTML, texte,
 * pièces jointes) SANS rien envoyer — utilisé par l'aperçu ET par l'envoi réel,
 * pour que "ce qu'on montre" et "ce qui part" soient IDENTIQUES.
 */
export async function preparerEnvoiLead(leadId: string) {
  const supabase = createAdminClient()

  const { data: lead, error: leadErr } = await supabase
    .from('leads_partenaire')
    .select('id, nom, email, devis_numero')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !lead) throw new Error('Lead introuvable')
  if (!lead.email) throw new Error('Ce client n’a pas d’adresse e-mail')
  if (!lead.devis_numero) throw new Error('Aucun devis généré pour ce lead')

  const { data: devis, error: devisErr } = await supabase
    .from('devis_claudus')
    .select('numero, reference, montant_ttc, pdf_path, pdf_filename')
    .eq('numero', lead.devis_numero)
    .maybeSingle()
  if (devisErr || !devis) throw new Error('Devis introuvable')
  if (!devis.pdf_path) throw new Error('PDF du devis pas encore disponible')

  const { data: pdfBlob, error: pdfErr } = await supabase.storage
    .from('devis-claudus-pdfs')
    .download(devis.pdf_path)
  if (pdfErr || !pdfBlob) throw new Error('Téléchargement du PDF du devis impossible')
  const devisBuffer = Buffer.from(await pdfBlob.arrayBuffer())

  const catalogueFichier = devis.reference ? CATALOGUES[devis.reference] : undefined
  let catalogueBuffer: Buffer | null = null
  if (catalogueFichier) {
    const { data: catBlob, error: catErr } = await supabase.storage
      .from('catalogues-pdf')
      .download(catalogueFichier)
    // Le catalogue manquant ne doit JAMAIS bloquer l'envoi du devis : on
    // l'omet silencieusement de la pièce jointe plutôt que de faire échouer
    // tout l'envoi pour un bonus.
    if (!catErr && catBlob) catalogueBuffer = Buffer.from(await catBlob.arrayBuffer())
  }

  const contenu: Contenu = {
    nom: nomAffiche(lead.nom),
    numero: devis.numero,
    produit: produitAffiche(devis.reference),
    montantTtc: devis.montant_ttc,
    avecCatalogue: !!catalogueBuffer,
  }
  const sujet = `Votre devis ${devis.numero} — ${ENTREPRISE.nom}`

  const attachments: { filename: string; content: Buffer }[] = [
    { filename: devis.pdf_filename || `${devis.numero}.pdf`, content: devisBuffer },
  ]
  if (catalogueBuffer) {
    attachments.push({ filename: 'Catalogue portes de garage sectionnelles.pdf', content: catalogueBuffer })
  }

  return {
    lead, devis,
    destinataire: lead.email,
    sujet,
    html: emailHtml(contenu),
    texte: emailTexte(contenu),
    attachments,
    avecCatalogue: !!catalogueBuffer,
  }
}

// Envoi via la VRAIE boîte IONOS (contact@renov-r.com), pas Resend : le SPF du
// domaine n'autorise que _spf-eu.ionos.com et aucun DKIM n'y est configuré
// pour Resend (vérifié le 02/09/2026 — dig SPF/DKIM/MX sur renov-r.com). Un
// mail "From: contact@renov-r.com" envoyé par Resend échoue l'alignement SPF
// et atterrit probablement en spam. En passant par le vrai SMTP IONOS, le mail
// est authentifié exactement comme un envoi manuel depuis cette boîte.
function transporteur() {
  const host = process.env.SMTP_HOST || 'smtp.ionos.fr'
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER || ENTREPRISE.email
  const pass = process.env.SMTP_PASSWORD
  if (!pass) throw new Error('SMTP_PASSWORD manquante (variable d\'environnement)')
  return nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass },
  })
}

export async function envoyerDevisLead(leadId: string): Promise<EnvoiResultat> {
  const supabase = createAdminClient()
  try {
    const prep = await preparerEnvoiLead(leadId)

    await transporteur().sendMail({
      from: `${ENTREPRISE.nom} <${ENTREPRISE.email}>`,
      replyTo: ENTREPRISE.email,
      to: prep.destinataire,
      subject: prep.sujet,
      html: prep.html,
      text: prep.texte,
      attachments: prep.attachments,
    })

    await supabase.from('leads_partenaire').update({
      envoi_statut: 'envoye', envoye_le: new Date().toISOString(), envoi_erreur: null,
    }).eq('id', leadId)

    return { ok: true, destinataire: prep.destinataire, sujet: prep.sujet, avec_catalogue: prep.avecCatalogue }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await supabase.from('leads_partenaire').update({
      envoi_statut: 'erreur', envoi_erreur: message.slice(0, 2000),
    }).eq('id', leadId)
    return { ok: false, erreur: message }
  }
}
