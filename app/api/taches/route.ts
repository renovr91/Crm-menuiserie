import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const showDone = request.nextUrl.searchParams.get('done') === 'true'

  let query = supabase
    .from('taches')
    .select('*, clients(id, nom, telephone), commerciaux(id, nom, couleur), affaires(id, titre)')
    .order('created_at', { ascending: false })

  if (!showDone) query = query.eq('fait', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()

  if (!body.titre || !body.commercial_id) {
    return NextResponse.json({ error: 'titre et commercial_id requis' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('taches')
    .insert({
      titre: body.titre,
      note: body.note || null,
      commercial_id: body.commercial_id,
      client_id: body.client_id || null,
      affaire_id: body.affaire_id || null,
      rappel_at: body.rappel_at || null,
      pieces_jointes: body.pieces_jointes || [],
    })
    .select('*, clients(id, nom, telephone), commerciaux(id, nom, couleur), affaires(id, titre)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
