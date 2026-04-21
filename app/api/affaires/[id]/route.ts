import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()

  const updates: Record<string, unknown> = {}
  if (body.pipeline_stage !== undefined) updates.pipeline_stage = body.pipeline_stage
  if (body.titre !== undefined) updates.titre = body.titre
  if (body.description !== undefined) updates.description = body.description || null
  if (body.montant_estime !== undefined) updates.montant_estime = body.montant_estime || 0
  if (body.commercial_id !== undefined) updates.commercial_id = body.commercial_id || null
  if (body.client_id !== undefined) updates.client_id = body.client_id
  updates.updated_at = new Date().toISOString()

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'Aucun champ a mettre a jour' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('affaires')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('affaires').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
