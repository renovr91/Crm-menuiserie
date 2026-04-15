import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotifSMS } from '@/lib/ovh-sms'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: devis, error } = await supabase.from('devis').select('*, clients(nom, telephone)').eq('id', id).single()
  if (error || !devis) return NextResponse.json({ error: 'Devis non trouv\u00e9' }, { status: 404 })

  const client = devis.clients as { nom: string; telephone: string; portal_token: string }
  if (!client.telephone) return NextResponse.json({ error: 'Pas de t\u00e9l\u00e9phone client' }, { status: 400 })

  const reqUrl = new URL(request.url)
  const origin = `${reqUrl.protocol}//${reqUrl.host}`
  const devisUrl = `${origin}/d/${devis.token}`
  const message = `Bonjour ${client.nom}, votre devis ${devis.reference || ''} est disponible. Consultez et signez-le en ligne : ${devisUrl} - RENOV-R 91`
  try {
    await sendNotifSMS(client.telephone, message)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  await supabase.from('devis').update({ status: 'envoye', sent_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ success: true })
}
