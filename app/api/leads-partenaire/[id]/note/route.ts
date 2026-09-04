import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// POST /api/leads-partenaire/[id]/note  { note: string }
// Note de suivi manuelle (relance faite ou non, résultat) — distincte du champ
// `note` automatique qui explique un blocage d'envoi. Protégé par le
// middleware admin (session) comme le reste de /leads-partenaire.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { note?: unknown }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 2000) : ''
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('leads_partenaire')
    .update({ note_relance: note || null })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, erreur: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
