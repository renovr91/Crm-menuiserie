import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*, devis(id, reference, status, montant_ht, montant_ttc, created_at)')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()

  const { data, error } = await supabase
    .from('clients')
    .update({
      nom: body.nom,
      telephone: body.telephone?.replace(/\s/g, '') || null,
      email: body.email || null,
      adresse: body.adresse || null,
      code_postal: body.code_postal || null,
      ville: body.ville || null,
      notes: body.notes || null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()

  // Only update fields that are present in the body
  const updates: Record<string, unknown> = {}
  if (body.pipeline_stage !== undefined) updates.pipeline_stage = body.pipeline_stage
  if (body.commercial_id !== undefined) updates.commercial_id = body.commercial_id
  if (body.nom !== undefined) updates.nom = body.nom
  if (body.telephone !== undefined) updates.telephone = body.telephone?.replace(/\s/g, '') || null
  if (body.email !== undefined) updates.email = body.email || null
  if (body.adresse !== undefined) updates.adresse = body.adresse || null
  if (body.code_postal !== undefined) updates.code_postal = body.code_postal || null
  if (body.ville !== undefined) updates.ville = body.ville || null
  if (body.notes !== undefined) updates.notes = body.notes || null
  if (body.source !== undefined) updates.source = body.source || null
  if (body.besoin !== undefined) updates.besoin = body.besoin || null
  if (body.montant_estime !== undefined) updates.montant_estime = body.montant_estime || null
  if (body.priorite !== undefined) updates.priorite = body.priorite || null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ a mettre a jour' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('clients')
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
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
