import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const client_id = searchParams.get('client_id')
  const commercial_id = searchParams.get('commercial_id')
  const pending = searchParams.get('pending')

  let query = supabase
    .from('activites')
    .select('*, clients(nom), commerciaux(nom)')
    .order('created_at', { ascending: false })

  if (client_id) query = query.eq('client_id', client_id)
  if (commercial_id) query = query.eq('commercial_id', commercial_id)
  if (pending === 'true') {
    query = query.eq('fait', false).not('date_prevue', 'is', null)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { client_id, commercial_id, type, contenu, date_prevue, fait } = body

  if (!client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 })
  if (!type) return NextResponse.json({ error: 'type requis' }, { status: 400 })

  const validTypes = ['appel', 'note', 'rappel', 'email', 'visite', 'relance']
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `type invalide, valeurs acceptées: ${validTypes.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('activites')
    .insert({
      client_id,
      commercial_id: commercial_id || null,
      type,
      contenu: contenu || null,
      date_prevue: date_prevue || null,
      fait: fait ?? false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
