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
  // Ligne légale, reprise telle quelle du gabarit des mails de signature
  // (validé par le gérant en août) : même pied de page sur tous les mails client.
  legal1: 'E.U.R.L. au capital de 5000 € · SIRET 939 278 024 00012',
  legal2: 'Assurance décennale QBE Europe · Certifié RGE',
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
  /** Phrase libre ajoutée sous l'introduction — ex. « Ce devis remplace le
   *  devis DC-01004… » quand on renvoie une version corrigée (02/09/2026,
   *  supplément livraison Belgique oublié sur un premier envoi). */
  note?: string
}

/** Options d'envoi : `note` = phrase ajoutée au mail (texte brut, échappée en HTML). */
export interface OptionsEnvoi {
  note?: string
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function emailTexte(c: Contenu) {
  const montant = c.montantTtc != null ? ` : ${eur(c.montantTtc)} TTC` : ''
  return [
    `Bonjour ${c.nom},`,
    '',
    `Merci pour votre demande. Voici votre devis ${c.numero} pour votre ${c.produit}${montant}, en pièce jointe.`,
    ...(c.note ? ['', c.note] : []),
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
    ENTREPRISE.legal1,
    ENTREPRISE.legal2,
  ].join('\n')
}

// Charte NOIR + DORÉ (pas le rouge du site) : même identité que les documents
// DocuSeal (logo extrait d'un mail de signature réel, 02/09/2026).
//
// Le logo part EN PIÈCE JOINTE INTÉGRÉE (cid:) et non en lien externe : lors
// du premier test, Gmail n'a pas affiché l'image chargée depuis le CRM (proxy
// d'images, image bloquée, ou cache d'une réponse ratée) — une image intégrée
// s'affiche toujours, sans dépendre d'un chargement distant. Le fichier vit
// dans le bucket Storage `catalogues-pdf` (comme le catalogue) : lire
// public/ par le système de fichiers n'est pas fiable sur Vercel (les fichiers
// statiques ne sont pas embarqués dans la fonction).
const LOGO_FICHIER = 'renov-r-logo-noir-dore.jpg'
const LOGO_CID = 'logo-renov-r'

/** URL publique du logo — pour l'APERÇU seulement (un `cid:` ne s'affiche que
 *  dans un vrai client mail). Le mail envoyé, lui, embarque le fichier. */
function logoUrlPublique() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  return `${base}/images/${LOGO_FICHIER}`
}

// Même gabarit que les mails de signature électronique (DocuSeal, validé par
// le gérant en août 2026) : tableau (rendu identique dans tous les clients
// mail), bandeau noir + logo + liseré doré, sur-titre, titre, texte, bloc
// doré, filet, pied de page complet. Seul le contenu change : ici le devis
// est en pièce jointe, il n'y a pas de bouton de signature.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const NOIR = '#1a1a1a'
const OR = '#c8a84e'
const OR_FONCE = '#a6893a'

function emailHtml(c: Contenu, logoSrc: string) {
  const montant = c.montantTtc != null ? `${eur(c.montantTtc)} TTC` : ''
  const texte = (txt: string, padding = '0 0 24px') =>
    `<div style="font:400 16px/1.7 ${FONT};color:#333333;padding:${padding};">${txt}</div>`
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Votre devis ${ENTREPRISE.nom}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
<tr>
<td align="center" style="padding:32px 16px;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#ffffff;">

<tr>
<td style="background:${NOIR};padding:26px 34px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td width="58" valign="middle" style="padding-right:16px;">
<img src="${logoSrc}" width="58" height="58" alt="RENOV-R" style="display:block;width:58px;height:58px;border:0;color:${OR};font:700 13px/58px ${FONT};letter-spacing:.06em;" />
</td>
<td valign="middle">
<div style="font:700 17px/1.3 ${FONT};color:${OR};letter-spacing:.06em;">RENOV-R</div>
<div style="font:400 13px/1.5 ${FONT};color:#9a9791;padding-top:3px;">Menuiseries sur mesure</div>
</td>
</tr>
</table>
</td>
</tr>
<tr><td style="background:${OR};font-size:0;line-height:0;height:3px;">&#160;</td></tr>

<tr>
<td style="padding:40px 34px 0;">

<div style="font:600 11px/1.4 ${FONT};letter-spacing:.16em;text-transform:uppercase;color:${OR_FONCE};padding-bottom:16px;">Devis ${c.numero}</div>

<div style="font:600 27px/1.28 ${FONT};color:${NOIR};padding-bottom:22px;">Votre devis est pr&#234;t</div>

${texte(`Bonjour ${c.nom},`, '0 0 16px')}
${texte(`Merci pour votre demande. Vous trouverez en pi&#232;ce jointe votre devis pour votre ${c.produit}.`, c.note ? '0 0 16px' : '0 0 28px')}
${c.note ? texte(escHtml(c.note), '0 0 28px') : ''}

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td style="border-left:3px solid ${OR};background:#faf7ee;padding:16px 20px;">
<div style="font:600 11px/1.4 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${OR_FONCE};padding-bottom:6px;">Montant</div>
<div style="font:700 22px/1.3 ${FONT};color:${NOIR};">${montant || 'voir le devis joint'}</div>
<div style="font:400 13px/1.6 ${FONT};color:#555555;padding-top:4px;">Devis ${c.numero} en pi&#232;ce jointe (PDF)${c.avecCatalogue ? ', accompagn&#233; de notre catalogue de portes sectionnelles' : ''}</div>
</td>
</tr>
</table>

${texte(`Une question, une cote &#224; v&#233;rifier&#160;? R&#233;pondez simplement &#224; ce message, ou appelez-nous au <strong style="color:${NOIR};">${ENTREPRISE.telephone}</strong>&#160;: nous vous accompagnons pour la suite.`, '34px 0 38px')}

</td>
</tr>

<tr><td style="padding:0 34px;"><div style="border-top:1px solid ${OR};font-size:0;line-height:0;">&#160;</div></td></tr>
<tr>
<td style="padding:22px 34px 30px;">
<div style="font:600 15px/1.6 ${FONT};color:${NOIR};">${ENTREPRISE.nom}</div>
<div style="font:400 14px/1.8 ${FONT};color:#555555;">
${ENTREPRISE.adresse} &#8212; ${ENTREPRISE.cp_ville}<br />
${ENTREPRISE.telephone.replace(/ /g, '&#160;')} &#160;&#183;&#160; <a href="mailto:${ENTREPRISE.email}" style="color:${OR_FONCE};text-decoration:none;">${ENTREPRISE.email}</a> &#160;&#183;&#160; <a href="https://${ENTREPRISE.site}" style="color:${OR_FONCE};text-decoration:none;">${ENTREPRISE.site}</a>
</div>
<div style="font:400 12px/1.7 ${FONT};color:#8a8780;padding-top:14px;">
${ENTREPRISE.legal1.replace(' · ', ' &#160;&#183;&#160; ')}<br />
${ENTREPRISE.legal2.replace(' · ', ' &#160;&#183;&#160; ')}
</div>
</td>
</tr>

</table>

</td>
</tr>
</table>
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
export async function preparerEnvoiLead(leadId: string, options: OptionsEnvoi = {}) {
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

  // Logo intégré au mail (cid). Bonus comme le catalogue : s'il manque, le
  // mail part sans logo, jamais bloqué pour ça.
  let logoBuffer: Buffer | null = null
  {
    const { data: logoBlob, error: logoErr } = await supabase.storage
      .from('catalogues-pdf')
      .download(LOGO_FICHIER)
    if (!logoErr && logoBlob) logoBuffer = Buffer.from(await logoBlob.arrayBuffer())
  }

  const contenu: Contenu = {
    nom: nomAffiche(lead.nom),
    numero: devis.numero,
    produit: produitAffiche(devis.reference),
    montantTtc: devis.montant_ttc,
    avecCatalogue: !!catalogueBuffer,
    note: (options.note || '').trim().slice(0, 600) || undefined,
  }
  const sujet = `Votre devis ${devis.numero} — ${ENTREPRISE.nom}`

  const attachments: { filename: string; content: Buffer; cid?: string }[] = [
    { filename: devis.pdf_filename || `${devis.numero}.pdf`, content: devisBuffer },
  ]
  if (catalogueBuffer) {
    attachments.push({ filename: 'Catalogue portes de garage sectionnelles.pdf', content: catalogueBuffer })
  }
  if (logoBuffer) {
    attachments.push({ filename: LOGO_FICHIER, content: logoBuffer, cid: LOGO_CID })
  }

  return {
    lead, devis,
    destinataire: lead.email,
    sujet,
    // Le mail envoyé embarque le logo ; l'aperçu (navigateur) le charge en URL.
    html: emailHtml(contenu, logoBuffer ? `cid:${LOGO_CID}` : logoUrlPublique()),
    htmlApercu: emailHtml(contenu, logoUrlPublique()),
    texte: emailTexte(contenu),
    attachments,
    // Les VRAIES pièces jointes vues par le client (le logo intégré n'en est pas une).
    piecesJointes: attachments.filter((a) => !a.cid).map((a) => a.filename),
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

export async function envoyerDevisLead(leadId: string, options: OptionsEnvoi = {}): Promise<EnvoiResultat> {
  const supabase = createAdminClient()
  try {
    const prep = await preparerEnvoiLead(leadId, options)

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
