import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const commercialId = request.nextUrl.searchParams.get('commercial_id')

  let query = supabase
    .from('affaires')
    .select('*, clients(id, nom, telephone, email, source, adresse, ville, code_postal), commerciaux(nom, couleur)')
    .not('pipeline_stage', 'eq', 'termine')
    .not('pipeline_stage', 'eq', 'perdu')
    .order('created_at', { ascending: false })

  if (commercialId) query = query.eq('commercial_id', commercialId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()

  if (!body.client_id || !body.titre) {
    return NextResponse.json({ error: 'client_id et titre requis' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('affaires')
    .insert({
      client_id: body.client_id,
      titre: body.titre,
      description: body.description || null,
      pipeline_stage: 'nouveau',
      montant_estime: body.montant_estime || 0,
      commercial_id: body.commercial_id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const supabase = createAdminClient()
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('affaires').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
