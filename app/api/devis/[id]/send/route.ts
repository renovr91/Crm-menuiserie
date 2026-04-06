import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { envoyerSMS } from '@/lib/sms'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: devis, error } = await supabase.from('devis').select('*, clients(nom, telephone, portal_token)').eq('id', id).single()
  if (error || !devis) return NextResponse.json({ error: 'Devis non trouv\u00e9' }, { status: 404 })

  const client = devis.clients as { nom: string; telephone: string; portal_token: string }
  if (!client.telephone) return NextResponse.json({ error: 'Pas de t\u00e9l\u00e9phone client' }, { status: 400 })

  const portalUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/portail/${client.portal_token}`
  const message = `Bonjour ${client.nom}, votre devis ${devis.reference} est pr\u00eat. Consultez-le ici : ${portalUrl} - Renov-R`
  const result = await envoyerSMS(client.telephone, message)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 500 })

  await supabase.from('devis').update({ status: 'envoye', sent_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ success: true })
}
