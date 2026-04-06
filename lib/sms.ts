// OVH SMS API integration
// Docs: https://api.ovh.com/console/#/sms

import crypto from 'crypto'

const APP_KEY = process.env.OVH_SMS_APP_KEY!
const APP_SECRET = process.env.OVH_SMS_APP_SECRET!
const CONSUMER_KEY = process.env.OVH_SMS_CONSUMER_KEY!
const SERVICE_NAME = process.env.OVH_SMS_SERVICE_NAME!

const BASE_URL = 'https://eu.api.ovh.com/1.0'

function signRequest(method: string, url: string, body: string, timestamp: number): string {
  const toSign = `${APP_SECRET}+${CONSUMER_KEY}+${method}+${url}+${body}+${timestamp}`
  return '$1$' + crypto.createHash('sha1').update(toSign).digest('hex')
}

export async function envoyerSMS(telephone: string, message: string): Promise<{ success: boolean; error?: string }> {
  let numero = telephone.replace(/\s/g, '').replace(/\./g, '')
  if (numero.startsWith('0')) {
    numero = '0033' + numero.slice(1)
  }
  if (!numero.startsWith('00')) {
    numero = '0033' + numero
  }

  const url = `${BASE_URL}/sms/${SERVICE_NAME}/jobs`
  const body = JSON.stringify({
    charset: 'UTF-8',
    class: 'phoneDisplay',
    coding: '7bit',
    message,
    noStopClause: true,
    priority: 'high',
    receivers: [numero],
    sender: 'Renov-R',
    validityPeriod: 2880,
  })

  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signRequest('POST', url, body, timestamp)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ovh-Application': APP_KEY,
        'X-Ovh-Consumer': CONSUMER_KEY,
        'X-Ovh-Timestamp': String(timestamp),
        'X-Ovh-Signature': signature,
      },
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
