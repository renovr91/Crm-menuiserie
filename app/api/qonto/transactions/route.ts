import { NextResponse } from 'next/server'

const QONTO_LOGIN = (process.env.QONTO_LOGIN || '').trim()
const QONTO_SECRET = (process.env.QONTO_SECRET_KEY || '').trim()
const QONTO_IBAN = 'FR7616958000011144672670309'

export async function GET() {
  if (!QONTO_LOGIN || !QONTO_SECRET) {
    return NextResponse.json({ error: 'Qonto credentials manquantes' }, { status: 500 })
  }

  const from = new Date()
  from.setDate(from.getDate() - 30)

  const resp = await fetch(
    `https://thirdparty.qonto.com/v2/transactions?iban=${QONTO_IBAN}&status[]=completed&side=credit&settled_at_from=${from.toISOString()}&sort_by=settled_at:desc&per_page=50`,
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
  return NextResponse.json(data.transactions || [])
}
