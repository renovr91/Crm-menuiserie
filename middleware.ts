import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Chemins joignables SANS session : flux publics (signature client, portail),
// webhooks entrants (chacun vérifie SA propre signature/jeton) et crons Vercel
// (qui ne portent pas de cookie). Tout le reste exige une session admin.
// ⚠️ Le rapprochement se fait par SEGMENT (voir estPublic) : '/api/d' ne doit
// PAS ouvrir '/api/devis-claudus'. Bug corrigé le 01/09 — ces routes fuyaient
// nom + téléphone client et marges sans authentification.
const PUBLIC_PATHS = [
  '/login', '/portail', '/api/portail', '/api/signature', '/d', '/api/d',
  '/api/gmail/fetch-pj', '/api/stripe',
  '/api/qonto/sync',            // cron seul (transactions/match = session admin)
  '/api/taches/rappels',        // cron
  '/api/zadarma/webhook', '/api/zadarma/rattrapage',
  '/api/docuseal/webhook',
  '/api/leads/webhook',         // partenaire externe (jeton vérifié dans la route)
  '/api/agent',                 // jeton Bearer vérifié dans la route
]

// Rapprochement par SEGMENT de chemin, jamais par préfixe de texte : '/api/d'
// autorise '/api/d' et '/api/d/<token>', mais PAS '/api/devis-claudus'.
function estPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip auth check for public paths (rapprochement par segment)
  if (estPublic(pathname)) {
    return NextResponse.next()
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // [28/08] Incident : Supabase Auth ne répond plus depuis l'infra Vercel
  // (REST répond en 33 ms, /auth/v1/* ne répond jamais → le middleware était
  // tué à 25 s → 504 sur tout le CRM pour les utilisateurs connectés).
  // Parade : getUser est borné à 4 s ; en cas d'échec on bascule en mode
  // dégradé — lecture locale du jeton du cookie (émetteur, expiration).
  // Contrôle plus faible que getUser (pas de vérification de signature) :
  // à retirer quand l'incident Supabase sera clos.
  let user: { id: string } | null = null
  try {
    const res = (await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), 4000)),
    ])) as Awaited<ReturnType<typeof supabase.auth.getUser>>
    user = res.data.user
  } catch {
    user = utilisateurDepuisCookie(request)
  }

  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}


// Mode dégradé : décode le jeton d'accès du cookie Supabase sans appel réseau.
// Gère les cookies découpés (sb-…-auth-token.0/.1) et le préfixe base64-.
function utilisateurDepuisCookie(request: NextRequest): { id: string } | null {
  try {
    const morceaux = request.cookies
      .getAll()
      .filter((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (!morceaux.length) return null
    let valeur = decodeURIComponent(morceaux.map((c) => c.value).join(''))
    if (valeur.startsWith('base64-')) valeur = atob(valeur.slice(7))
    const session = JSON.parse(valeur)
    const jwt = String(session.access_token || '')
    const partie = jwt.split('.')[1]
    if (!partie) return null
    const claims = JSON.parse(atob(partie.replace(/-/g, '+').replace(/_/g, '/')))
    if (!claims.sub) return null
    if ((Number(claims.exp) || 0) * 1000 < Date.now()) return null
    const hote = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host
    if (!String(claims.iss || '').includes(hote)) return null
    return { id: String(claims.sub) }
  } catch {
    return null
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|portail|api/portail|api/signature|api/stripe|d/|api/d/).*)',
  ],
}
