import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminClient()

  const { data: devis, error } = await supabase
    .from('devis')
    .select('id, reference, status, montant_ht, tva, montant_ttc, pdf_url, signed_pdf_url, notes, signed_at, created_at, client_id')
    .eq('token', token)
    .single()

  if (error || !devis) {
    return NextResponse.json({ error: 'Devis non trouvé ou lien expiré' }, { status: 404 })
  }

  // Récupérer le nom client si possible
  let client_nom = ''
  if (devis.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('nom')
      .eq('id', devis.client_id)
      .single()
    if (client) client_nom = client.nom
  }

  // Marquer comme "lu" si c'était en brouillon ou envoyé
  if (devis.status === 'brouillon' || devis.status === 'envoye') {
    await supabase
      .from('devis')
      .update({ status: 'lu', read_at: new Date().toISOString() })
      .eq('id', devis.id)
  }

  return NextResponse.json({
    id: devis.id,
    reference: devis.reference,
    status: devis.status === 'brouillon' || devis.status === 'envoye' ? 'lu' : devis.status,
    montant_ht: devis.montant_ht,
    tva: devis.tva,
    montant_ttc: devis.montant_ttc,
    pdf_url: devis.pdf_url,
    signed_pdf_url: devis.signed_pdf_url,
    notes: devis.notes,
    signed_at: devis.signed_at,
    created_at: devis.created_at,
    client_nom
  })
}
