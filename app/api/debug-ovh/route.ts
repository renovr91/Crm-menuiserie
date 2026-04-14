import { NextResponse } from 'next/server'
import crypto from 'crypto'

export async function GET() {
  const AK = (process.env.OVH_APP_KEY || '').trim()
  const AS = (process.env.OVH_APP_SECRET || '').trim()
  const CK = (process.env.OVH_CONSUMER_KEY || '').trim()
  const SERVICE = (process.env.OVH_SMS_SERVICE || '').trim()

  // Check env vars
  const envCheck = {
    AK_len: AK.length,
    AS_len: AS.length,
    CK_len: CK.length,
    SERVICE_len: SERVICE.length,
    SERVICE_value: SERVICE,
    AK_first4: AK.slice(0, 4),
  }

  // Test server time
  let serverTime = ''
  let timeRaw = ''
  try {
    const timeResp = await fetch('https://eu.api.ovh.com/1.0/auth/time', { cache: 'no-store' })
    timeRaw = await timeResp.text()
    serverTime = timeRaw.trim()
  } catch (e) {
    return NextResponse.json({ error: 'fetch time failed', detail: String(e), envCheck })
  }

  // Test signature computation
  const method = 'GET'
  const url = `https://eu.api.ovh.com/1.0/sms/${SERVICE}`
  const bodyStr = ''
  const sigRaw = `${AS}+${CK}+${method}+${url}+${bodyStr}+${serverTime}`
  const sig = '$1$' + crypto.createHash('sha1').update(sigRaw).digest('hex')

  // Test API call
  let apiResult = ''
  let apiStatus = 0
  try {
    const resp = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        'X-Ovh-Application': AK,
        'X-Ovh-Timestamp': serverTime,
        'X-Ovh-Signature': sig,
        'X-Ovh-Consumer': CK,
      },
    })
    apiStatus = resp.status
    apiResult = await resp.text()
  } catch (e) {
    return NextResponse.json({ error: 'API call failed', detail: String(e), envCheck })
  }

  return NextResponse.json({
    envCheck,
    timeRaw_len: timeRaw.length,
    serverTime,
    sigRaw_len: sigRaw.length,
    sig_first20: sig.slice(0, 20),
    apiStatus,
    apiResult: apiResult.slice(0, 200),
    cryptoAvailable: typeof crypto.createHash === 'function',
  })
}
