import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function DELETE(request: NextRequest) {
  const supabase = createAdminClient()
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Supprimer les données liées d'abord
  await supabase.from('activites').delete().eq('client_id', id)
  await supabase.from('messages').delete().eq('client_id', id)
  await supabase.from('signatures').delete().eq('client_id', id)
  await supabase.from('client_photos').delete().eq('client_id', id)
  await supabase.from('sav_tickets').delete().eq('client_id', id)
  await supabase.from('payments').delete().eq('devis_id', id) // cleanup
  await supabase.from('devis').delete().eq('client_id', id)
  await supabase.from('commandes').delete().eq('client_id', id)
  await supabase.from('poses').delete().eq('client_id', id)

  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const commercialId = request.nextUrl.searchParams.get('commercial_id')

  let query = supabase
    .from('clients')
    .select('*, commerciaux(nom, couleur), devis(id, reference, status, montant_ttc, sent_at, signed_at, payment_status)')
    .not('pipeline_stage', 'eq', 'termine')
    .not('pipeline_stage', 'eq', 'perdu')
    .order('created_at', { ascending: false })

  if (commercialId) query = query.eq('commercial_id', commercialId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = new Date()
  const enriched = (data || []).map((client: Record<string, unknown>) => {
    const devisList = (client.devis || []) as Record<string, unknown>[]
    const alerts: string[] = []

    // Alert: new lead not contacted in 24h
    if (client.pipeline_stage === 'nouveau') {
      const created = new Date(client.created_at as string)
      const hours = (now.getTime() - created.getTime()) / (1000 * 60 * 60)
      if (hours > 24) alerts.push('a_contacter')
    }

    // Alert: devis sent without response
    const sentDevis = devisList.filter((d) => d.status === 'envoye' || d.status === 'lu')
    for (const d of sentDevis) {
      if (d.sent_at) {
        const sentDate = new Date(d.sent_at as string)
        const days = (now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24)
        if (days > 7) alerts.push('relance_urgente')
        else if (days > 3) alerts.push('a_relancer')
      }
    }

    const lastDevis = devisList.sort((a, b) =>
      new Date(b.sent_at as string || b.signed_at as string || '').getTime() -
      new Date(a.sent_at as string || a.signed_at as string || '').getTime()
    )[0]

    return {
      ...client,
      alerts,
      montant_devis: lastDevis ? Number(lastDevis.montant_ttc) : null,
      devis_count: devisList.length,
    }
  })

  return NextResponse.json(enriched)
}
