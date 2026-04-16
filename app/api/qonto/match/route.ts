import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// POST — manually match a Qonto transaction to a devis
export async function POST(request: NextRequest) {
  const { devis_id, montant, transaction_id, settled_at } = await request.json()

  if (!devis_id || !montant) {
    return NextResponse.json({ error: 'devis_id et montant requis' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Check devis exists
  const { data: devis } = await supabase
    .from('devis')
    .select('id, reference, payment_status')
    .eq('id', devis_id)
    .single()

  if (!devis) return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })

  if (devis.payment_status === 'paye') {
    return NextResponse.json({ error: 'Devis déjà payé' }, { status: 400 })
  }

  // Create payment record
  await supabase.from('payments').insert({
    devis_id,
    montant: Number(montant),
    methode: 'virement',
    status: 'confirme',
    confirmed_at: settled_at || new Date().toISOString(),
    reference_virement: transaction_id || null,
  })

  // Update devis status
  await supabase
    .from('devis')
    .update({ payment_status: 'paye' })
    .eq('id', devis_id)

  return NextResponse.json({ success: true, devis_reference: devis.reference })
}
