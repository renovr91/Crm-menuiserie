import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('commerciaux')
    .select('*')
    .order('nom', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { nom, telephone, email, couleur } = body

  if (!nom) return NextResponse.json({ error: 'Nom requis' }, { status: 400 })

  const { data, error } = await supabase
    .from('commerciaux')
    .insert({
      nom,
      telephone: telephone || null,
      email: email || null,
      couleur: couleur || '#3b82f6',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
