import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// GET /api/devis-claudus/[numero]/download
// Génère une signed URL temporaire pour télécharger le PDF depuis le bucket Storage
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ numero: string }> }
) {
  try {
    const { numero } = await context.params
    const supabase = createAdminClient()

    const { data: devis, error: fetchErr } = await supabase
      .from('devis_claudus')
      .select('pdf_path, pdf_filename')
      .eq('numero', numero)
      .maybeSingle()

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    if (!devis || !devis.pdf_path) {
      return NextResponse.json({ error: 'PDF non disponible pour ce devis' }, { status: 404 })
    }

    const { data: signed, error: signErr } = await supabase
      .storage
      .from('devis-claudus-pdfs')
      .createSignedUrl(devis.pdf_path, 60 * 5, { download: devis.pdf_filename || undefined })

    if (signErr || !signed) {
      return NextResponse.json({ error: signErr?.message || 'Signed URL failed' }, { status: 500 })
    }

    return NextResponse.json({ url: signed.signedUrl, filename: devis.pdf_filename })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
