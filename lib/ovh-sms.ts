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
    sender: process.env.OVH_SMS_SENDER || '+33179725225',
    noStopClause: true,
    priority: 'high',
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
