import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getCurrentCommercial } from '@/lib/get-commercial'
import { logActivity } from '@/lib/activity-log'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.titre !== undefined) updates.titre = body.titre
  if (body.note !== undefined) updates.note = body.note || null
  if (body.commercial_id !== undefined) updates.commercial_id = body.commercial_id
  if (body.client_id !== undefined) updates.client_id = body.client_id || null
  if (body.affaire_id !== undefined) updates.affaire_id = body.affaire_id || null
  if (body.rappel_at !== undefined) updates.rappel_at = body.rappel_at || null
  if (body.pieces_jointes !== undefined) updates.pieces_jointes = body.pieces_jointes
  if (body.fait !== undefined) {
    updates.fait = body.fait
    updates.fait_at = body.fait ? new Date().toISOString() : null
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('taches')
    .update(updates)
    .eq('id', id)
    .select('*, clients(id, nom, telephone), commerciaux(id, nom, couleur), affaires(id, titre)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const me = await getCurrentCommercial()
  if (me) {
    const actionType = body.fait ? 'tache_done' : 'tache_update'
    await logActivity({
      commercial_id: me.id,
      user_id: me.user_id,
      action_type: actionType,
      entity_type: 'tache',
      entity_id: id,
      details: { titre: data.titre, ...body },
    })
  }

  return NextResponse.json(data)
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('taches').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
