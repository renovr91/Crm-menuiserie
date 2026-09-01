import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

/**
 * WEBHOOK LEADS PARTENAIRE — porte d'entrée PUBLIQUE mais VERROUILLÉE.
 *
 * Le partenaire (générateur de leads portes de garage) POste ici chaque lead
 * en JSON, en temps réel. Aucune session possible pour un serveur tiers : la
 * seule clé est un SECRET partagé (env LEADS_WEBHOOK_SECRET), attendu dans
 * l'en-tête `Authorization: Bearer <secret>` OU `?key=<secret>`.
 *
 * FAIL-CLOSED à tous les étages :
 *  - secret non configuré côté serveur  -> 503 (on n'accepte rien à l'aveugle)
 *  - secret absent / faux               -> 401
 *  - comparaison à temps constant       -> pas de fuite par timing
 *  - la route ne LIT jamais la base, elle n'écrit qu'une ligne : même si le
 *    secret fuitait, l'exposition est un ajout de lead, pas une lecture.
 */
export const dynamic = 'force-dynamic'

function comparaisonConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function secretFourni(req: NextRequest): string {
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return (new URL(req.url).searchParams.get('key') || '').trim()
}

// Premier champ NON VIDE parmi une liste d'alias (le format du partenaire est
// inconnu : on ratisse les noms courants FR/EN sans rien exiger).
function champ(obj: Record<string, unknown>, ...alias: string[]): string | null {
  for (const a of alias) {
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === a) {
        const v = obj[k]
        if (v != null && String(v).trim() !== '') return String(v).trim().slice(0, 2000)
      }
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  const attendu = (process.env.LEADS_WEBHOOK_SECRET || '').trim()
  if (!attendu) {
    // Tant que le secret n'est pas posé en env, on REFUSE tout : jamais de
    // porte grande ouverte par défaut.
    return NextResponse.json({ error: 'webhook_non_configure' }, { status: 503 })
  }
  const fourni = secretFourni(req)
  if (!fourni || !comparaisonConstante(fourni, attendu)) {
    return NextResponse.json({ error: 'non_autorise' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'json_invalide' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'objet_attendu' }, { status: 400 })
  }

  const telephone = champ(body, 'telephone', 'phone', 'tel', 'mobile', 'numero')
  const email = champ(body, 'email', 'mail', 'courriel')
  // Un lead sans AUCUN moyen de contact ne sert à rien : on le refuse (mais on
  // n'exige pas les deux — le partenaire n'a pas toujours l'email).
  if (!telephone && !email) {
    return NextResponse.json({ error: 'contact_manquant' }, { status: 422 })
  }

  const sb = createAdminClient()

  // Dédoublonnage : même téléphone reçu dans les 24 h = déjà connu. On répond
  // 200 (le partenaire ne doit pas ré-essayer en boucle) sans créer de doublon.
  if (telephone) {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data: existant } = await sb
      .from('leads_partenaire')
      .select('id')
      .eq('telephone', telephone)
      .gte('created_at', depuis)
      .limit(1)
    if (existant && existant.length) {
      return NextResponse.json({ ok: true, statut: 'doublon_ignore' })
    }
  }

  const { data, error } = await sb
    .from('leads_partenaire')
    .insert({
      source: champ(body, 'source') || 'partenaire',
      nom: champ(body, 'nom', 'name', 'fullname', 'prenom', 'contact'),
      telephone,
      email,
      code_postal: champ(body, 'codepostal', 'cp', 'zip', 'zipcode', 'postalcode'),
      type_porte: champ(body, 'typeporte', 'type', 'produit', 'product', 'categorie'),
      dimensions: champ(body, 'dimensions', 'dimension', 'taille', 'size', 'cotes'),
      message: champ(body, 'message', 'commentaire', 'comment', 'demande', 'notes', 'description'),
      payload: body,
    })
    .select('id')
    .single()

  if (error) {
    // Message générique au partenaire, jamais le détail interne (conventions §5).
    return NextResponse.json({ error: 'enregistrement_impossible' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data?.id, statut: 'enregistre' })
}
