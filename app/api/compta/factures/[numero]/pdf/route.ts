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
    if (!f?.pdf_path)
      return NextResponse.json({ error: `Aucun PDF archivé pour ${numero} : il se crée à la première consultation depuis le site (route admin ou porte de service).` }, { status: 404 })

    const [bucket, ...reste] = f.pdf_path.split('/')
    const { data: signed, error } = await sb.storage.from(bucket).createSignedUrl(reste.join('/'), 300)
    if (error || !signed?.signedUrl)
      return NextResponse.json({ error: error?.message || 'Signature impossible' }, { status: 500 })
    return NextResponse.redirect(signed.signedUrl, 307)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
