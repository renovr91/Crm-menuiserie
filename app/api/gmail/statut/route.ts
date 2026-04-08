import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const supabase = createAdminClient()
  const update: Record<string, unknown> = {}

  if (body.statut) update.statut = body.statut
  if (body.nouveau_message !== undefined) update.nouveau_message = body.nouveau_message
  if (body.devis_envoye_at) update.devis_envoye_at = body.devis_envoye_at

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Rien a mettre a jour' }, { status: 400 })
  }

  const { error } = await supabase
    .from('messages')
    .update(update)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
