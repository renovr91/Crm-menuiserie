import { NextResponse } from 'next/server'

const QONTO_LOGIN = (process.env.QONTO_LOGIN || '').trim()
const QONTO_SECRET = (process.env.QONTO_SECRET_KEY || '').trim()
const QONTO_IBAN = 'FR7616958000011144672670309'

export async function GET(req: Request) {
  if (!QONTO_LOGIN || !QONTO_SECRET) {
    return NextResponse.json({ error: 'Qonto credentials manquantes' }, { status: 500 })
  }

  // Fenêtre réglable (?days=90) : l'écran de pointage vit à 30 jours, mais
  // retrouver un acompte ancien (donneur d'ordre qui solde des mois après)
  // demande de remonter plus loin. Borné à 365 pour rester raisonnable.
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 30))
  const from = new Date()
  from.setDate(from.getDate() - days)

  // Qonto pagine à 100 max : sans la boucle, une fenêtre large rendait les 50
  // plus récents EN SILENCE et les vieux acomptes semblaient ne pas exister.
  const transactions: unknown[] = []
  for (let page = 1; page <= 20; page++) {
    const resp = await fetch(
      `https://thirdparty.qonto.com/v2/transactions?iban=${QONTO_IBAN}&status[]=completed&side=credit&settled_at_from=${from.toISOString()}&sort_by=settled_at:desc&per_page=100&current_page=${page}`,
      {
        headers: { 'Authorization': `${QONTO_LOGIN}:${QONTO_SECRET}` },
        cache: 'no-store',
      }
    )

    if (!resp.ok) {
      const err = await resp.text()
      return NextResponse.json({ error: `Qonto ${resp.status}: ${err}` }, { status: 500 })
    }

    const data = await resp.json()
    transactions.push(...(data.transactions || []))
    if (!data.meta?.next_page) break
  }
  return NextResponse.json(transactions)
}
