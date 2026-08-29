import { NextRequest, NextResponse } from 'next/server'

// PDF d'une proforma. Le rendu vit sur le SITE (même générateur que les
// factures, même charte) : le CRM le demande par la porte de service, avec le
// jeton dédié, et relaie le flux. Aucune duplication du générateur ici — deux
// rendus finiraient par diverger, comme c'est déjà arrivé sur les factures.
export async function GET(req: NextRequest, ctx: { params: Promise<{ numero: string }> }) {
  const { numero } = await ctx.params
  const base = (process.env.SITE_FACTURES_URL || '').replace(/\/$/, '')
  const jeton = process.env.SERVICE_FACTURES_TOKEN || ''
  if (!base || !jeton) {
    return NextResponse.json({ error: 'Rendu PDF non configuré (SITE_FACTURES_URL / SERVICE_FACTURES_TOKEN)' }, { status: 503 })
  }

  try {
    const r = await fetch(`${base}/api/service/proformas/pdf?ref=${encodeURIComponent(numero)}`, {
      headers: { 'x-service-token': jeton },
      cache: 'no-store',
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return NextResponse.json(
        { error: `Rendu refusé (${r.status})`, detail: detail.slice(0, 200) },
        { status: r.status === 404 ? 404 : 502 },
      )
    }
    return new NextResponse(await r.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${numero}.pdf"`,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
