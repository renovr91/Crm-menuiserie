import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*, devis(id, status, montant_ttc)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { nom, telephone, email, adresse, code_postal, ville, notes } = body

  if (!nom) return NextResponse.json({ error: 'Nom requis' }, { status: 400 })

  // Check duplicate by phone if provided
  if (telephone) {
    const cleanPhone = telephone.replace(/\s/g, '')
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('telephone', cleanPhone)
      .single()
    if (existing) {
      return NextResponse.json({ error: 'Un client avec ce telephone existe deja' }, { status: 409 })
    }
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({
      nom,
      telephone: telephone?.replace(/\s/g, '') || null,
      email: email || null,
      adresse: adresse || null,
      code_postal: code_postal || null,
      ville: ville || null,
      notes: notes || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
