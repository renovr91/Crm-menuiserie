import crypto from 'crypto'

const AK = (process.env.OVH_APP_KEY || '').trim()
const AS = (process.env.OVH_APP_SECRET || '').trim()
const CK = (process.env.OVH_CONSUMER_KEY || '').trim()
const SERVICE = (process.env.OVH_SMS_SERVICE || '').trim()
const BASE = 'https://eu.api.ovh.com/1.0'

async function ovhRequest(method: string, path: string, body?: object) {
  const url = `${BASE}${path}`
  const bodyStr = body ? JSON.stringify(body) : ''

  // Get OVH server time (no-store to prevent Next.js caching stale timestamps)
  const timeResp = await fetch(`${BASE}/auth/time`, { cache: 'no-store' })
  const serverTime = (await timeResp.text()).trim()

  // Build signature
  const sigRaw = `${AS}+${CK}+${method}+${url}+${bodyStr}+${serverTime}`
  const sig = '$1$' + crypto.createHash('sha1').update(sigRaw).digest('hex')

  const resp = await fetch(url, {
    method,
    cache: 'no-store',
    headers: {
      'X-Ovh-Application': AK,
      'X-Ovh-Timestamp': serverTime,
      'X-Ovh-Signature': sig,
      'X-Ovh-Consumer': CK,
      'Content-Type': 'application/json',
    },
    body: bodyStr || undefined,
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OVH ${resp.status}: ${err}`)
  }

  return resp.json()
}

function formatPhone(phone: string) {
  let formatted = phone.replace(/\s/g, '')
  if (formatted.startsWith('0')) {
    formatted = '+33' + formatted.slice(1)
  } else if (!formatted.startsWith('+')) {
    formatted = '+33' + formatted
  }
  return formatted
}

// SMS transactionnel (OTP, codes) — pas de clause STOP, pas d'URL
export async function sendSMS(phone: string, message: string) {
  return ovhRequest('POST', `/sms/${SERVICE}/jobs`, {
    message,
    receivers: [formatPhone(phone)],
    // Un numéro FIXE ne peut pas être expéditeur de SMS : sans OVH_SMS_SENDER
    // (mobile validé chez OVH), on laisse OVH fournir un numéro permettant la réponse.
    ...(process.env.OVH_SMS_SENDER ? { sender: process.env.OVH_SMS_SENDER } : { senderForResponse: true }),
    noStopClause: true,
    priority: 'high',
  })
}

/** Mobile français (06/07, +336/+337, 00336/00337) ? Les fixes et l'étranger
 *  ne reçoivent pas de SMS : on ne tente même pas. */
export function estMobileFrancais(phone: string | null | undefined) {
  const t = String(phone || '').replace(/[\s.\-()]/g, '')
  return /^(\+33|0033|0)[67]\d{8}$/.test(t)
}

// SMS TRANSACTIONNEL de suivi (« votre devis vous a été envoyé par e-mail ») :
// le client a demandé ce devis, ce n'est pas de la prospection → pas de clause
// STOP (elle mangerait 11 caractères et ferait passer le message à 2 SMS).
// Demande gérant 04/09/2026. Priorité normale (rien d'urgent).
export async function sendDevisSMS(phone: string, message: string) {
  const sender = process.env.OVH_SMS_SENDER
  return ovhRequest('POST', `/sms/${SERVICE}/jobs`, {
    message,
    receivers: [formatPhone(phone)],
    ...(sender ? { sender } : { senderForResponse: true }),
    noStopClause: true,
    priority: 'medium',
  })
}

// SMS notification (envoi devis, relances) — avec URL possible
export async function sendNotifSMS(phone: string, message: string) {
  const sender = process.env.OVH_SMS_SENDER
  return ovhRequest('POST', `/sms/${SERVICE}/jobs`, {
    message,
    receivers: [formatPhone(phone)],
    ...(sender ? { sender } : { senderForResponse: true }),
    noStopClause: false,
    priority: 'high',
  })
}

// ---------------------------------------------------------------------------
// Réponses des clients
// ---------------------------------------------------------------------------

export interface ReponseSms {
  id: number
  sender: string          // le numéro du client
  message: string
  tag: string | null      // identique au tag du SMS envoyé → corrélation
  creationDatetime: string
}

/** Liste les réponses en attente chez OVH (gratuit, non facturé). */
export async function listerReponses(): Promise<ReponseSms[]> {
  const ids: number[] = await ovhRequest('GET', `/sms/${SERVICE}/incoming`)
  if (!Array.isArray(ids) || ids.length === 0) return []
  // Borné : une file anormalement longue ne doit pas faire expirer la fonction.
  const lot = ids.slice(-50)
  const details = await Promise.all(
    lot.map((id) => ovhRequest('GET', `/sms/${SERVICE}/incoming/${id}`).catch(() => null)),
  )
  return details.filter(Boolean) as ReponseSms[]
}

/** Retire une réponse de la file OVH une fois archivée chez nous. */
export async function supprimerReponse(id: number) {
  return ovhRequest('DELETE', `/sms/${SERVICE}/incoming/${id}`)
}
