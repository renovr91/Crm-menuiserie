import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const QONTO_LOGIN = (process.env.QONTO_LOGIN || '').trim()
const QONTO_SECRET = (process.env.QONTO_SECRET_KEY || '').trim()
const QONTO_IBAN = 'FR7616958000011144672670309'
const QONTO_BASE = 'https://thirdparty.qonto.com/v2'

async function qontoRequest(path: string) {
  const resp = await fetch(`${QONTO_BASE}${path}`, {
    headers: { 'Authorization': `${QONTO_LOGIN}:${QONTO_SECRET}` },
    cache: 'no-store',
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Qonto ${resp.status}: ${err}`)
  }
  return resp.json()
}

// GET — Sync virements Qonto → match avec devis en attente de paiement
export async function GET() {
  if (!QONTO_LOGIN || !QONTO_SECRET) {
    return NextResponse.json({ error: 'Qonto credentials manquantes' }, { status: 500 })
  }

  const supabase = createAdminClient()

  // 1. Récupérer les devis en attente de paiement par virement
  const { data: devisEnAttente } = await supabase
    .from('devis')
    .select('id, reference, montant_ttc, acompte_pct, payment_status')
    .in('payment_status', ['en_attente', null])
    .eq('status', 'signe')

  if (!devisEnAttente || devisEnAttente.length === 0) {
    return NextResponse.json({ matched: 0, message: 'Aucun devis en attente' })
  }

  // 2. Récupérer les virements reçus (credit) des 30 derniers jours
  const from = new Date()
  from.setDate(from.getDate() - 30)

  const data = await qontoRequest(
    `/transactions?iban=${QONTO_IBAN}&status[]=completed&side=credit&settled_at_from=${from.toISOString()}&sort_by=settled_at:desc&per_page=100`
  )

  const transactions = data.transactions || []
  let matched = 0
  const matches: { devis_ref: string; amount: number; label: string }[] = []

  // 3. Matcher chaque transaction avec un devis
  for (const tx of transactions) {
    const label = (tx.label || '').toUpperCase()
    const reference = (tx.reference || '').toUpperCase()
    const amount = Number(tx.amount)

    for (const devis of devisEnAttente) {
      const ref = (devis.reference || '').toUpperCase()
      if (!ref) continue

      // Match par référence dans le label ou la référence du virement
      if (!label.includes(ref) && !reference.includes(ref)) continue

      // Vérifier le montant (acompte ou total)
      const acomptePct = Number(devis.acompte_pct) || 0
      const montantAttendu = acomptePct > 0
        ? Math.round(Number(devis.montant_ttc) * acomptePct) / 100
        : Number(devis.montant_ttc)

      // Tolérance de 1€ pour les arrondis
      if (Math.abs(amount - montantAttendu) > 1) continue

      // Match trouvé ! Enregistrer le paiement
      const { data: existingPayment } = await supabase
        .from('payments')
        .select('id')
        .eq('devis_id', devis.id)
        .eq('methode', 'virement')
        .eq('status', 'confirme')
        .single()

      if (existingPayment) continue // Déjà enregistré

      await supabase.from('payments').insert({
        devis_id: devis.id,
        montant: amount,
        methode: 'virement',
        status: 'confirme',
        confirmed_at: tx.settled_at || new Date().toISOString(),
        reference_virement: tx.transaction_id || tx.id,
      })

      await supabase
        .from('devis')
        .update({ payment_status: 'paye' })
        .eq('id', devis.id)

      matched++
      matches.push({ devis_ref: devis.reference, amount, label: tx.label })

      // Retirer de la liste pour pas matcher deux fois
      devisEnAttente.splice(devisEnAttente.indexOf(devis), 1)
      break
    }
  }

  return NextResponse.json({
    matched,
    checked_transactions: transactions.length,
    pending_devis: devisEnAttente.length,
    matches,
  })
}
