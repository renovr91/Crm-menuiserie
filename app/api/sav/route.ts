import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const client_id = searchParams.get('client_id')
  const status = searchParams.get('status')
  const priorite = searchParams.get('priorite')
  const commercial_id = searchParams.get('commercial_id')

  let query = supabase
    .from('sav_tickets')
    .select('*, clients(nom, telephone), commerciaux(nom)')
    .order('created_at', { ascending: false })

  if (client_id) query = query.eq('client_id', client_id)
  if (status) query = query.eq('status', status)
  if (priorite) query = query.eq('priorite', priorite)
  if (commercial_id) query = query.eq('commercial_id', commercial_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { client_id, commercial_id, sujet, description, priorite, notes } = body

  if (!client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 })
  if (!sujet) return NextResponse.json({ error: 'sujet requis' }, { status: 400 })

  const { data, error } = await supabase
    .from('sav_tickets')
    .insert({
      client_id,
      commercial_id: commercial_id || null,
      sujet,
      description: description || null,
      priorite: priorite || 'moyenne',
      status: 'ouvert',
      notes: notes || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
