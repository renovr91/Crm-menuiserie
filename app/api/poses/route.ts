import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const commercial_id = searchParams.get('commercial_id')
  const status = searchParams.get('status')

  let query = supabase
    .from('poses')
    .select('*, clients(nom, telephone, adresse), commerciaux(nom), commandes(designation)')
    .order('date_pose', { ascending: true, nullsFirst: false })

  if (commercial_id) query = query.eq('commercial_id', commercial_id)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const {
    client_id, commande_id, commercial_id, adresse,
    date_pose, heure_debut, duree_estimee, status, notes,
  } = body

  if (!client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 })

  const { data, error } = await supabase
    .from('poses')
    .insert({
      client_id,
      commande_id: commande_id || null,
      commercial_id: commercial_id || null,
      adresse: adresse || null,
      date_pose: date_pose || null,
      heure_debut: heure_debut || null,
      duree_estimee: duree_estimee || null,
      status: status || 'planifiee',
      notes: notes || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
