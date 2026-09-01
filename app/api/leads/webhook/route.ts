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

/**
 * Téléphone NORMALISÉ, sinon « +33 6 60 11 69 68 », « 06.60.11.69.68 » et
 * « 0660116968 » sont trois numéros différents pour le dédoublonnage (point
 * relevé par le partenaire, 01/09 — on ne dépend pas de sa normalisation).
 * +33 / 0033 -> 0 ; l'indicatif « + » est conservé pour l'étranger.
 */
function normaliserTelephone(brut: string | null): string | null {
  if (!brut) return null
  let t = String(brut).replace(/[\s.\-()]/g, '')
  if (t.startsWith('0033')) t = '0' + t.slice(4)
  else if (t.startsWith('+33')) t = '0' + t.slice(3)
  else if (t.startsWith('33') && t.length === 11) t = '0' + t.slice(2)
  return t || null
}

function secretFourni(req: NextRequest): string {
  const auth = req.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  return (new URL(req.url).searchParams.get('key') || '').trim()
}

/**
 * JOURNAL DE TOUS LES APPELS, acceptés ou refusés. Sans lui, un envoi refusé
 * (clé fausse, contact manquant) ne laissait AUCUNE trace hors des logs de
 * l'hébergeur : impossible de répondre « le partenaire a-t-il envoyé ? »
 * depuis le CRM (constat du 02/09, premier lead réel). Écrit AVANT de
 * répondre : une écriture lancée après la réponse peut être gelée par
 * l'hébergeur. Ne stocke jamais la clé fournie, seulement le verdict.
 */
async function journaliser(
  sb: ReturnType<typeof createAdminClient>,
  req: NextRequest,
  statut: number,
  resultat: string,
  extra: { nom?: string | null; telephone?: string | null; lead_id?: string | null; extrait?: string | null } = {}
) {
  try {
    await sb.from('leads_webhook_journal').insert({
      statut_http: statut,
      resultat,
      ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 200) || null,
      nom: extra.nom ?? null,
      telephone: extra.telephone ?? null,
      lead_id: extra.lead_id ?? null,
      extrait: extra.extrait ?? null,
    })
  } catch {
    // Le journal ne doit JAMAIS faire échouer la prise du lead.
  }
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

/**
 * Le secret attendu : variable d'environnement EN PRIORITÉ, sinon la table
 * `parametres_secrets` (RLS active, service_role uniquement). Ce second canal
 * existe pour pouvoir configurer le webhook sans accès au tableau de bord de
 * l'hébergeur ; poser l'env var plus tard la fera gagner, sans rien casser.
 */
async function secretAttendu(sb: ReturnType<typeof createAdminClient>): Promise<string> {
  const env = (process.env.LEADS_WEBHOOK_SECRET || '').trim()
  if (env) return env
  const { data } = await sb
    .from('parametres_secrets')
    .select('valeur')
    .eq('nom', 'LEADS_WEBHOOK_SECRET')
    .maybeSingle()
  return String(data?.valeur || '').trim()
}

export async function POST(req: NextRequest) {
  const sb = createAdminClient()
  const attendu = await secretAttendu(sb)
  if (!attendu) {
    // Tant que le secret n'est pas posé en env, on REFUSE tout : jamais de
    // porte grande ouverte par défaut.
    await journaliser(sb, req, 503, 'webhook_non_configure')
    return NextResponse.json({ error: 'webhook_non_configure' }, { status: 503 })
  }
  const fourni = secretFourni(req)
  if (!fourni || !comparaisonConstante(fourni, attendu)) {
    await journaliser(sb, req, 401, 'non_autorise')
    return NextResponse.json({ error: 'non_autorise' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    await journaliser(sb, req, 400, 'json_invalide')
    return NextResponse.json({ error: 'json_invalide' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    await journaliser(sb, req, 400, 'objet_attendu')
    return NextResponse.json({ error: 'objet_attendu' }, { status: 400 })
  }

  const telephone = normaliserTelephone(champ(body, 'telephone', 'phone', 'tel', 'mobile', 'numero'))
  const email = champ(body, 'email', 'mail', 'courriel')
  // Un lead sans AUCUN moyen de contact ne sert à rien : on le refuse (mais on
  // n'exige pas les deux — le partenaire n'a pas toujours l'email).
  const nom = champ(body, 'nom', 'name', 'fullname', 'prenom', 'contact')
  if (!telephone && !email) {
    // L'extrait du corps reçu sert à voir QUEL nom de champ le partenaire a
    // utilisé (alias manquant chez nous ?) sans retourner lire ses logs.
    await journaliser(sb, req, 422, 'contact_manquant', { nom, extrait: JSON.stringify(body).slice(0, 400) })
    return NextResponse.json({ error: 'contact_manquant' }, { status: 422 })
  }

  const type_porte = champ(body, 'typeporte', 'type', 'produit', 'product', 'categorie')
  const dimensions = champ(body, 'dimensions', 'dimension', 'taille', 'size', 'cotes')
  const message = champ(body, 'message', 'commentaire', 'comment', 'demande', 'notes', 'description')

  // Dédoublonnage : un même téléphone AVEC LA MÊME DEMANDE dans les 24 h.
  // Le téléphone seul ne suffit pas : un client peut légitimement demander deux
  // portes (deux biens, deux dimensions) le même jour — les fondre ferait
  // perdre une affaire en silence. On compare donc aussi le CONTENU.
  const empreinte = [type_porte, dimensions, message]
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase())
    .join('|')
  if (telephone) {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data: recents } = await sb
      .from('leads_partenaire')
      .select('id, type_porte, dimensions, message')
      .eq('telephone', telephone)
      .gte('created_at', depuis)
      .limit(20)
    const jumeau = (recents || []).find((r: { type_porte: string | null; dimensions: string | null; message: string | null; id: string }) => [r.type_porte, r.dimensions, r.message]
      .map((x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase())
      .join('|') === empreinte)
    if (jumeau) {
      // 200 pour que l'émetteur ne réessaie pas en boucle, MAIS le corps dit
      // sans ambiguïté que RIEN n'a été créé (remarque du partenaire, 01/09 :
      // « un 200 ne prouve pas la prise en compte »).
      await journaliser(sb, req, 200, 'doublon_ignore', { nom, telephone, lead_id: jumeau.id })
      return NextResponse.json({
        ok: true, enregistre: false, doublon: true,
        id: jumeau.id, statut: 'doublon_ignore',
        message: 'Demande identique déjà reçue pour ce téléphone dans les dernières 24 h — aucun nouveau lead créé.',
      })
    }
  }

  const { data, error } = await sb
    .from('leads_partenaire')
    .insert({
      source: champ(body, 'source') || 'partenaire',
      nom,
      telephone,
      email,
      code_postal: champ(body, 'codepostal', 'cp', 'zip', 'zipcode', 'postalcode'),
      type_porte,
      dimensions,
      message,
      payload: body,
    })
    .select('id')
    .single()

  if (error) {
    // Message générique au partenaire, jamais le détail interne (conventions §5).
    await journaliser(sb, req, 500, 'enregistrement_impossible', { nom, telephone })
    return NextResponse.json({ error: 'enregistrement_impossible' }, { status: 500 })
  }
  await journaliser(sb, req, 200, 'enregistre', { nom, telephone, lead_id: data?.id ?? null })
  return NextResponse.json({ ok: true, enregistre: true, doublon: false, id: data?.id, statut: 'enregistre' })
}
