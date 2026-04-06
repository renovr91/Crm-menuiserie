import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminClient()

  const { data: client, error } = await supabase.from('clients').select('id, nom').eq('portal_token', token).single()
  if (error || !client) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })

  const { data: devisList } = await supabase.from('devis').select('*').eq('client_id', client.id).in('status', ['envoye', 'lu', 'signe']).order('created_at', { ascending: false })

  const devisEnvoyes = devisList?.filter((d) => d.status === 'envoye') || []
  if (devisEnvoyes.length > 0) {
    await supabase.from('devis').update({ status: 'lu', read_at: new Date().toISOString() }).in('id', devisEnvoyes.map((d) => d.id))
  }

  return NextResponse.json({ client: { nom: client.nom }, devis: devisList || [] })
}
