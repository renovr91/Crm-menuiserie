import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// POST /api/leads-partenaire/[id]/bloquer  { bloque: true | false }
// « Ne pas envoyer » / « Autoriser l'envoi » : l'automate d'envoi (cron
// envoi-leads du VPS) saute tout lead dont envoi_bloque = true. Protégé par le
// middleware admin (session) comme le reste de /leads-partenaire.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { bloque?: unknown }
  const bloque = body?.bloque === true
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('leads_partenaire')
    .update({ envoi_bloque: bloque })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, erreur: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, envoi_bloque: bloque })
}
