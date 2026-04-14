import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/ovh-sms'

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminClient()

  // Trouver le devis + client
  const { data: devis, error } = await supabase
    .from('devis')
    .select('id, status, client_id')
    .eq('token', token)
    .single()

  if (error || !devis) {
    return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })
  }

  if (devis.status === 'signe') {
    return NextResponse.json({ error: 'Devis déjà signé' }, { status: 400 })
  }

  // Récupérer le téléphone du client
  let phone = ''
  if (devis.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('telephone')
      .eq('id', devis.client_id)
      .single()
    if (client?.telephone) phone = client.telephone
  }

  if (!phone) {
    return NextResponse.json({ error: 'Aucun numéro de téléphone associé' }, { status: 400 })
  }

  // Rate limit: max 3 codes par devis en 10 min
  const { count } = await supabase
    .from('otp_codes')
    .select('*', { count: 'exact', head: true })
    .eq('devis_id', devis.id)
    .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

  if (count && count >= 3) {
    return NextResponse.json({ error: 'Trop de tentatives. Réessayez dans 10 minutes.' }, { status: 429 })
  }

  // Générer code 6 chiffres
  const code = String(Math.floor(100000 + Math.random() * 900000))

  // Sauvegarder en base
  await supabase.from('otp_codes').insert({
    devis_id: devis.id,
    phone,
    code,
  })

  // Envoyer SMS
  try {
    await sendSMS(phone, `RENOV-R 91 - Votre code de signature : ${code}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Erreur envoi SMS:', msg)
    return NextResponse.json({ error: `Erreur envoi SMS: ${msg}` }, { status: 500 })
  }

  // Masquer le numéro pour l'affichage
  const clean = phone.replace(/\s/g, '')
  const masked = clean.slice(0, 2) + ' •• •• •• ' + clean.slice(-2)

  return NextResponse.json({ success: true, phone_masked: masked })
}
