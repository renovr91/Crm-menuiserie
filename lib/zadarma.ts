import crypto from 'crypto'

const KEY = (process.env.ZADARMA_API_KEY || '').trim()
const SECRET = (process.env.ZADARMA_API_SECRET || '').trim()
const BASE = 'https://api.zadarma.com'

// Signature Zadarma : base64( hex( hmac_sha1( method + paramsStr + md5(paramsStr), secret ) ) )
function signRequest(method: string, params: Record<string, string>) {
  const sorted = Object.keys(params).sort()
  const usp = new URLSearchParams()
  for (const k of sorted) usp.append(k, params[k])
  const paramsStr = usp.toString()
  const md5 = crypto.createHash('md5').update(paramsStr).digest('hex')
  const hmacHex = crypto.createHmac('sha1', SECRET).update(method + paramsStr + md5).digest('hex')
  const sign = Buffer.from(hmacHex).toString('base64')
  return { paramsStr, sign }
}

export async function zadarma(
  method: string,
  params: Record<string, string> = {},
  http: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'
) {
  if (!KEY || !SECRET) throw new Error('ZADARMA_API_KEY / ZADARMA_API_SECRET manquantes')
  const { paramsStr, sign } = signRequest(method, params)
  const headers: Record<string, string> = { Authorization: `${KEY}:${sign}` }
  let url = BASE + method
  const init: RequestInit = { method: http, headers, cache: 'no-store' }
  if (http === 'GET') {
    url += paramsStr ? `?${paramsStr}` : ''
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = paramsStr
  }
  const resp = await fetch(url, init)
  const text = await resp.text()
  if (!resp.ok) throw new Error(`Zadarma ${resp.status}: ${text}`)
  return JSON.parse(text)
}

// Récupère le lien de téléchargement de l'enregistrement d'un appel
export async function getRecordingLink(callId: string): Promise<string | null> {
  const res = await zadarma('/v1/pbx/record/request/', { call_id: callId, lifetime: '5400' })
  if (res.status !== 'success') return null
  // L'API renvoie soit `link`, soit `links` (tableau) selon le nombre de fichiers
  if (res.link) return res.link as string
  if (Array.isArray(res.links) && res.links.length) return res.links[0] as string
  return null
}

// Décalage (en minutes) de Europe/Paris par rapport à UTC pour l'instant donné.
// Gère automatiquement l'heure d'été (+120) / hiver (+60).
function parisOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = parseInt(part.value, 10)
  }
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second)
  return Math.round((asUTC - date.getTime()) / 60000)
}

// Zadarma envoie call_start en heure locale du compte (Europe/Paris) SANS fuseau,
// ex. "2026-07-15 17:19:12". Sur Vercel (serveur en UTC), `new Date(...)` l'interprète
// comme de l'UTC -> décalage de +1h/+2h. On l'interprète donc explicitement en Europe/Paris.
export function parseZadarmaDate(s?: string): string {
  const fallback = new Date().toISOString()
  if (!s) return fallback
  const str = s.trim()
  // Chaîne déjà datée avec fuseau (Z ou +hh:mm) : on fait confiance à new Date().
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) {
    const d = new Date(str)
    return isNaN(d.getTime()) ? fallback : d.toISOString()
  }
  // Chaîne naïve "YYYY-MM-DD HH:MM(:SS)" -> heure murale de Paris.
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) {
    const d = new Date(str)
    return isNaN(d.getTime()) ? fallback : d.toISOString()
  }
  const [, y, mo, d, h, mi, se] = m
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0))
  const offsetMin = parisOffsetMinutes(new Date(guess))
  return new Date(guess - offsetMin * 60000).toISOString()
}

// Vérifie la signature d'un webhook Zadarma (header "Signature").
// bodyRaw = corps brut x-www-form-urlencoded. Non-bloquant : renvoie true/false.
export function verifyWebhookSignature(bodyRaw: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !SECRET) return false
  const expected = Buffer.from(
    crypto.createHmac('sha1', SECRET).update(bodyRaw).digest('hex')
  ).toString('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  } catch {
    return false
  }
}
