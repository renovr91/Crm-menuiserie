import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../../../_lib'

// GET /api/compta/factures/FA-2026-00001/pdf → redirige vers une URL signée
// (5 min) du bucket privé factures-pdfs.
export async function GET(req: NextRequest, ctx: { params: Promise<{ numero: string }> }) {
  try {
    const { numero } = await ctx.params
    const sb = admin()
    const { data: f } = await sb
      .from('factures').select('pdf_path').eq('numero', numero)
      .eq('environnement', envFacturation(req)).single()

    if (f?.pdf_path) {
      const [bucket, ...reste] = f.pdf_path.split('/')
      const { data: signed, error } = await sb.storage.from(bucket).createSignedUrl(reste.join('/'), 300)
      if (error || !signed?.signedUrl)
        return NextResponse.json({ error: error?.message || 'Signature impossible' }, { status: 500 })
      return NextResponse.redirect(signed.signedUrl, 307)
    }

    // PAS D'ARCHIVE — cas normal, pas une erreur : un paiement vient d'être
    // saisi et l'ancien PDF (sans la mention d'acquittement) a été retiré.
    // Le rendu vit sur le SITE : on le lui demande par la porte de service —
    // il regénère, ré-archive, et les téléchargements suivants repartiront de
    // l'archive. Le bouton du back-office marche donc TOUJOURS.
    const base = (process.env.SITE_FACTURES_URL || '').replace(/\/$/, '')
    const jeton = process.env.SERVICE_FACTURES_TOKEN || ''
    if (!base || !jeton)
      return NextResponse.json({ error: 'Rendu non configuré (SITE_FACTURES_URL / SERVICE_FACTURES_TOKEN)' }, { status: 503 })
    const r = await fetch(`${base}/api/service/factures/pdf?ref=${encodeURIComponent(numero)}`, {
      headers: { 'x-service-token': jeton }, cache: 'no-store',
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return NextResponse.json({ error: `Rendu refusé (${r.status})`, detail: detail.slice(0, 200) }, { status: r.status === 404 ? 404 : 502 })
    }
    return new NextResponse(await r.arrayBuffer(), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${numero}.pdf"` },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
