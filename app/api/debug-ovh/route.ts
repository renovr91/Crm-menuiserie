import { NextResponse } from 'next/server'
import crypto from 'crypto'

export async function GET() {
  const AK = (process.env.OVH_APP_KEY || '').trim()
  const AS = (process.env.OVH_APP_SECRET || '').trim()
  const CK = (process.env.OVH_CONSUMER_KEY || '').trim()
  const SERVICE = (process.env.OVH_SMS_SERVICE || '').trim()

  // Test POST with body (same as sendSMS)
  const timeResp = await fetch('https://eu.api.ovh.com/1.0/auth/time', { cache: 'no-store' })
  const serverTime = (await timeResp.text()).trim()

  const method = 'POST'
  const url = `https://eu.api.ovh.com/1.0/sms/${SERVICE}/jobs`
  const body = {
    message: 'TEST DEBUG - ne pas envoyer',
    receivers: ['+33600000000'],
    sender: '+33179725225',
    noStopClause: true,
    priority: 'high',
  }
  const bodyStr = JSON.stringify(body)

  const sigRaw = `${AS}+${CK}+${method}+${url}+${bodyStr}+${serverTime}`
  const sig = '$1$' + crypto.createHash('sha1').update(sigRaw).digest('hex')

  // Don't actually send - just do a dry run by checking if a GET to /jobs works
  // But test the POST signature by calling with the real signature
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
    body: bodyStr,
  })

  const apiStatus = resp.status
  const apiResult = await resp.text()

  return NextResponse.json({
    serverTime,
    bodyStr_len: bodyStr.length,
    bodyStr_preview: bodyStr.slice(0, 100),
    sigRaw_len: sigRaw.length,
    sig: sig.slice(0, 25),
    apiStatus,
    apiResult: apiResult.slice(0, 300),
  })
}
