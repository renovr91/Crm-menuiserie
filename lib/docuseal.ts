/**
 * Client DocuSeal — LECTURE SEULE.
 *
 * ⚠️ La clé API DocuSeal peut aussi ENVOYER et SUPPRIMER des demandes de signature.
 * Ce module n'expose volontairement AUCUNE fonction d'écriture : le panneau
 * Signatures est un écran de consultation. Ne pas ajouter ici de POST/DELETE
 * sans une décision explicite — sinon un back-office prévu pour regarder
 * devient capable de déclencher des envois.
 *
 * L'endpoint est lu depuis DOCUSEAL_BASE (compte européen : https://api.docuseal.eu).
 * Ne JAMAIS coder l'URL en dur : api.docuseal.com renverrait 401 sur ce compte.
 */

const BASE = (process.env.DOCUSEAL_BASE || '').replace(/\/+$/, '')
const KEY = process.env.DOCUSEAL_API_KEY || ''

export type StatutSignature = 'envoye' | 'ouvert' | 'signe' | 'refuse' | 'expire'

export interface Submitter {
  id: number
  name: string | null
  email: string | null
  phone: string | null
  status: string | null
  sent_at: string | null
  opened_at: string | null
  completed_at: string | null
  declined_at: string | null
  role: string | null
}

export interface Submission {
  id: number
  name: string | null
  slug: string | null
  status: string | null
  created_at: string | null
  completed_at: string | null
  expire_at: string | null
  archived_at: string | null
  audit_log_url: string | null
  combined_document_url: string | null
  submitters: Submitter[]
}

function assertConfig() {
  if (!BASE || !KEY) {
    throw new Error('DocuSeal non configuré : DOCUSEAL_BASE et DOCUSEAL_API_KEY sont requis')
  }
}

/** GET brut sur l'API DocuSeal. Aucune autre méthode HTTP n'est permise ici. */
async function get(path: string) {
  assertConfig()
  const resp = await fetch(BASE + path, {
    method: 'GET',
    headers: { 'X-Auth-Token': KEY, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`DocuSeal ${resp.status}: ${txt.slice(0, 200)}`)
  }
  return resp.json()
}

/**
 * Liste les submissions (pagination par curseur `after`).
 * maxPages borne l'appel : le compte tourne à ~15 envois, on ne boucle pas à l'infini.
 */
export async function listSubmissions(maxPages = 10): Promise<Submission[]> {
  const out: Submission[] = []
  let after: number | null = null
  for (let i = 0; i < maxPages; i++) {
    const q: string = `/submissions?limit=100${after ? `&after=${after}` : ''}`
    const page = await get(q)
    const data: Submission[] = page?.data || []
    out.push(...data)
    const next = page?.pagination?.next
    if (!next || data.length === 0) break
    after = next
  }
  return out
}

/** Le n° de devis est dans le nom de la submission : "Devis DC-00903 — ..." ou "DC-00882 — ...". */
export function extractNumero(name: string | null | undefined): string | null {
  const m = /DC-\d+/i.exec(name || '')
  return m ? m[0].toUpperCase() : null
}

/** Statut métier consolidé à partir de la submission et de son signataire. */
export function statutDe(s: Submission): StatutSignature {
  const sub = (s.submitters || [])[0]
  if (s.status === 'completed' || sub?.completed_at) return 'signe'
  if (sub?.declined_at) return 'refuse'
  if (s.expire_at && new Date(s.expire_at).getTime() < Date.now()) return 'expire'
  if (sub?.opened_at) return 'ouvert'
  return 'envoye'
}

/** Date d'envoi (le submitter porte l'info la plus fiable). */
export function envoyeLe(s: Submission): string | null {
  return (s.submitters || [])[0]?.sent_at || s.created_at || null
}
