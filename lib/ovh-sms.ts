import crypto from 'crypto'

const AK = process.env.OVH_APP_KEY!
const AS = process.env.OVH_APP_SECRET!
const CK = process.env.OVH_CONSUMER_KEY!
const SERVICE = process.env.OVH_SMS_SERVICE!
const BASE = 'https://eu.api.ovh.com/1.0'

async function ovhRequest(method: string, path: string, body?: object) {
  const url = `${BASE}${path}`
  const bodyStr = body ? JSON.stringify(body) : ''

  // Get OVH server time
  const timeResp = await fetch(`${BASE}/auth/time`)
  const serverTime = (await timeResp.text()).trim()

  // Build signature
  const sigRaw = `${AS}+${CK}+${method}+${url}+${bodyStr}+${serverTime}`
  const sig = '$1$' + crypto.createHash('sha1').update(sigRaw).digest('hex')

  const resp = await fetch(url, {
    method,
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

export async function sendSMS(phone: string, message: string) {
  // Format phone: 0632... -> +33632...
  let formatted = phone.replace(/\s/g, '')
  if (formatted.startsWith('0')) {
    formatted = '+33' + formatted.slice(1)
  } else if (!formatted.startsWith('+')) {
    formatted = '+33' + formatted
  }

  return ovhRequest('POST', `/sms/${SERVICE}/jobs`, {
    message,
    receivers: [formatted],
    sender: '+33179725225',
    noStopClause: true,
    priority: 'high',
  })
}
