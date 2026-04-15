import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import Stripe from 'stripe'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-03-25.dahlia' })
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Webhook signature verification failed:', msg)
    return NextResponse.json({ error: `Webhook Error: ${msg}` }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const supabase = createAdminClient()

    // Mettre à jour le payment
    const { data: payment } = await supabase
      .from('payments')
      .update({
        status: 'confirme',
        confirmed_at: new Date().toISOString(),
        stripe_payment_intent: session.payment_intent as string,
      })
      .eq('stripe_session_id', session.id)
      .select('devis_id')
      .single()

    if (payment) {
      // Mettre à jour le devis
      await supabase
        .from('devis')
        .update({ payment_status: 'paye' })
        .eq('id', payment.devis_id)
    }
  }

  return NextResponse.json({ received: true })
}
