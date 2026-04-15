import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const client_id = searchParams.get('client_id')
  const status = searchParams.get('status')
  const fournisseur = searchParams.get('fournisseur')

  let query = supabase
    .from('commandes')
    .select('*, clients(nom, telephone)')
    .order('date_livraison_prevue', { ascending: true, nullsFirst: false })

  if (client_id) query = query.eq('client_id', client_id)
  if (status) query = query.eq('status', status)
  if (fournisseur) query = query.eq('fournisseur', fournisseur)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const {
    client_id, devis_id, fournisseur, reference_commande,
    designation, date_commande, delai_prevu, date_livraison_prevue,
    status, notes,
  } = body

  if (!client_id) return NextResponse.json({ error: 'client_id requis' }, { status: 400 })
  if (!fournisseur) return NextResponse.json({ error: 'fournisseur requis' }, { status: 400 })

  const { data, error } = await supabase
    .from('commandes')
    .insert({
      client_id,
      devis_id: devis_id || null,
      fournisseur,
      reference_commande: reference_commande || null,
      designation: designation || null,
      date_commande: date_commande || null,
      delai_prevu: delai_prevu || null,
      date_livraison_prevue: date_livraison_prevue || null,
      status: status || 'en_attente',
      notes: notes || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
