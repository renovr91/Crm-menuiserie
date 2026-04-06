import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { envoyerSMS } from '@/lib/sms'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('devis').select('*, clients(nom, telephone, email, portal_token)').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { client, devis, sendSMS } = body

  if (!client.telephone) return NextResponse.json({ error: 'T\u00e9l\u00e9phone requis' }, { status: 400 })

  let clientId: string
  const { data: existing } = await supabase.from('clients').select('id').eq('telephone', client.telephone.replace(/\s/g, '')).single()

  if (existing) {
    clientId = existing.id
    await supabase.from('clients').update({ nom: client.nom, email: client.email || null, adresse: client.adresse || null, code_postal: client.code_postal || null, ville: client.ville || null }).eq('id', clientId)
  } else {
    const { data: newClient, error: clientError } = await supabase.from('clients').insert({ nom: client.nom, telephone: client.telephone.replace(/\s/g, ''), email: client.email || null, adresse: client.adresse || null, code_postal: client.code_postal || null, ville: client.ville || null }).select().single()
    if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 })
    clientId = newClient.id
  }

  const { data: newDevis, error: devisError } = await supabase.from('devis').insert({ client_id: clientId, lignes: devis.lignes, montant_ht: devis.montant_ht, tva: devis.tva, montant_ttc: devis.montant_ttc, notes: devis.notes || null, status: sendSMS ? 'envoye' : 'brouillon', sent_at: sendSMS ? new Date().toISOString() : null }).select().single()
  if (devisError) return NextResponse.json({ error: devisError.message }, { status: 500 })

  if (sendSMS) {
    const { data: clientData } = await supabase.from('clients').select('portal_token').eq('id', clientId).single()
    const portalUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/portail/${clientData?.portal_token}`
    const smsMessage = `Bonjour ${client.nom}, votre devis ${newDevis.reference} est pr\u00eat. Consultez-le ici : ${portalUrl} - Renov-R`
    const smsResult = await envoyerSMS(client.telephone, smsMessage)
    if (!smsResult.success) console.error('SMS error:', smsResult.error)
  }

  return NextResponse.json({ devis: newDevis })
}
