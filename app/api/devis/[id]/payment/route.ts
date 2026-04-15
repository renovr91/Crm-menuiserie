import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// GET — récupérer les paiements d'un devis
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('devis_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST — marquer un virement comme reçu
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: devis } = await supabase
    .from('devis')
    .select('id, montant_ttc, acompte_pct')
    .eq('id', id)
    .single()

  if (!devis) return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })

  const acomptePct = Number(devis.acompte_pct) || 0
  const montant = acomptePct > 0
    ? Math.round(devis.montant_ttc * acomptePct) / 100
    : devis.montant_ttc

  // Créer le paiement confirmé
  await supabase.from('payments').insert({
    devis_id: id,
    montant,
    methode: 'virement',
    status: 'confirme',
    confirmed_at: new Date().toISOString(),
    reference_virement: devis.id.slice(0, 8),
  })

  // Mettre à jour le devis
  await supabase
    .from('devis')
    .update({ payment_status: 'paye' })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
