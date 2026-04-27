/**
 * Ringover API client.
 * Used server-side only (route handlers). Never imported in components.
 */

const RINGOVER_API = 'https://public-api.ringover.com/v2'

function apiKey(): string {
  const k = process.env.RINGOVER_API_KEY
  if (!k) throw new Error('RINGOVER_API_KEY not set')
  return k
}

export interface RingoverCall {
  cdr_id: number
  call_id: string
  direction: 'in' | 'out'
  type: string
  last_state: string
  is_answered: boolean
  start_time: string
  answered_time: string | null
  end_time: string | null
  total_duration: number | null
  incall_duration: number | null
  from_number: string
  to_number: string
  contact_number: string | null
  record: string | null
  user: {
    user_id: number
    email: string
    firstname: string
    lastname: string
  } | null
  // Allow extra fields without typing them (Ringover returns ~30 columns)
  [key: string]: unknown
}

interface RingoverCallList {
  call_list: RingoverCall[]
  total_call_count: number
}

/**
 * List calls from Ringover API.
 * @param opts.limit Max calls to return (Ringover max 1000, default 100)
 * @param opts.since ISO date string to filter calls after this date
 */
export async function listCalls(opts: { limit?: number; since?: string } = {}): Promise<RingoverCall[]> {
  const limit = opts.limit ?? 100
  const params = new URLSearchParams({ limit: String(limit) })
  if (opts.since) params.set('start_date', opts.since)

  const r = await fetch(`${RINGOVER_API}/calls?${params}`, {
    headers: { Authorization: apiKey() },
  })
  if (!r.ok) throw new Error(`Ringover API ${r.status}: ${await r.text()}`)
  const data = (await r.json()) as RingoverCallList
  return data.call_list || []
}

/**
 * Download a recording from Ringover.
 * The record_url returned by the API may already be public (signed URL),
 * but we add Authorization header just in case.
 */
export async function downloadRecord(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { Authorization: apiKey() } })
  if (!r.ok) throw new Error(`Download record ${r.status}: ${await r.text()}`)
  const ab = await r.arrayBuffer()
  return Buffer.from(ab)
}

/**
 * Normalize phone number for matching against clients.telephone / lbc_leads.telephone.
 * Examples:
 *  - "33673716765"     -> "0673716765"
 *  - "+33 6 73 71 67 65" -> "0673716765"
 *  - "0673716765"      -> "0673716765"
 */
export function normalizePhone(num: string | null | undefined): string {
  if (!num) return ''
  let n = num.replace(/\D/g, '')
  if (n.startsWith('33') && n.length === 11) n = '0' + n.slice(2)
  return n
}
