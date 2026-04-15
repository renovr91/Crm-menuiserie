import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import Stripe from 'stripe'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminClient()

  // Récupérer le devis
  const { data: devis, error } = await supabase
    .from('devis')
    .select('id, reference, status, montant_ttc, acompte_pct, payment_status')
    .eq('token', token)
    .single()

  if (error || !devis) {
    return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })
  }

  if (devis.status !== 'signe') {
    return NextResponse.json({ error: 'Le devis doit être signé avant le paiement' }, { status: 400 })
  }

  if (devis.payment_status === 'paye') {
    return NextResponse.json({ error: 'Devis déjà payé' }, { status: 400 })
  }

  // Calculer le montant à payer
  const acomptePct = Number(devis.acompte_pct) || 0
  const montant = acomptePct > 0
    ? Math.round(devis.montant_ttc * acomptePct) / 100
    : devis.montant_ttc

  const montantCentimes = Math.round(montant * 100)

  const description = acomptePct > 0
    ? `Acompte ${acomptePct}% — Devis ${devis.reference || devis.id}`
    : `Paiement — Devis ${devis.reference || devis.id}`

  // Créer la session Stripe Checkout
  const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || ''

  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: {
          name: description,
          description: `RENOV-R 91 — ${devis.reference || 'Devis'}`,
        },
        unit_amount: montantCentimes,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${origin}/d/${token}?paid=1`,
    cancel_url: `${origin}/d/${token}`,
    metadata: {
      devis_id: devis.id,
      token,
    },
  })

  // Enregistrer le paiement en attente
  await supabase.from('payments').insert({
    devis_id: devis.id,
    montant,
    methode: 'stripe',
    status: 'en_attente',
    stripe_session_id: session.id,
  })

  // Mettre à jour le statut paiement
  await supabase
    .from('devis')
    .update({ payment_status: 'en_attente' })
    .eq('id', devis.id)

  return NextResponse.json({ url: session.url })
}
