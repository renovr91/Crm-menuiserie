import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { envoyerSMS } from '@/lib/sms'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()
  const { client, devis, sendSMS } = body

  // Check current status
  const { data: current } = await supabase.from('devis').select('status, client_id').eq('id', id).single()
  if (!current) return NextResponse.json({ error: 'Devis non trouve' }, { status: 404 })
  if (current.status === 'signe') return NextResponse.json({ error: 'Impossible de modifier un devis signe' }, { status: 403 })

  // Update client
  await supabase.from('clients').update({
    nom: client.nom,
    email: client.email || null,
    adresse: client.adresse || null,
    code_postal: client.code_postal || null,
    ville: client.ville || null,
  }).eq('id', current.client_id)

  // Update devis — reset to brouillon if was envoye/lu
  const newStatus = sendSMS ? 'envoye' : 'brouillon'
  const { data: updated, error: updateError } = await supabase.from('devis').update({
    lignes: devis.lignes,
    montant_ht: devis.montant_ht,
    tva: devis.tva,
    montant_ttc: devis.montant_ttc,
    notes: devis.notes || null,
    status: newStatus,
    sent_at: sendSMS ? new Date().toISOString() : null,
    read_at: null,
  }).eq('id', id).select().single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Send SMS if requested
  if (sendSMS) {
    const { data: clientData } = await supabase.from('clients').select('portal_token').eq('id', current.client_id).single()
    const portalUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/portail/${clientData?.portal_token}`
    const smsMessage = `Bonjour ${client.nom}, votre devis ${updated.reference} a ete mis a jour. Consultez-le ici : ${portalUrl} - Renov-R`
    const smsResult = await envoyerSMS(client.telephone, smsMessage)
    if (!smsResult.success) console.error('SMS error:', smsResult.error)
  }

  return NextResponse.json({ devis: updated })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  // Delete signatures first (FK constraint)
  await supabase.from('signatures').delete().eq('devis_id', id)

  // Delete devis
  const { error } = await supabase.from('devis').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
