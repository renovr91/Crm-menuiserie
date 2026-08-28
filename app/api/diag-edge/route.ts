import { NextResponse } from 'next/server'

// Sonde de diagnostic TEMPORAIRE — runtime edge, comme le middleware.
// Mesure depuis l'infra Vercel ce que le middleware n'arrive pas à faire.
export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const resultats: Record<string, unknown> = {
    env_url_longueur: url.length,
    env_url_saut_de_ligne: /\s/.test(url),
    env_key_longueur: key.length,
    env_key_saut_de_ligne: /\s/.test(key),
  }

  for (const [nom, cible] of [
    ['auth_health', `${url}/auth/v1/health`],
    ['rest', `${url}/rest/v1/`],
  ] as const) {
    const t0 = Date.now()
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const r = await fetch(cible, { headers: { apikey: key }, signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(timer)
      resultats[nom] = `HTTP ${r.status} en ${Date.now() - t0} ms`
    } catch (e) {
      resultats[nom] = `ECHEC apres ${Date.now() - t0} ms : ${e instanceof Error ? e.name + ' ' + e.message : 'inconnu'}`
    }
  }
  return NextResponse.json(resultats)
}
