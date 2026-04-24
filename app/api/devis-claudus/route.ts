import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// GET /api/devis-claudus?client=xxx&user=xxx&from=YYYY-MM-DD&limit=100
// Liste les devis générés via le CLI Devis Claudus (table public.devis_claudus)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const clientFilter = searchParams.get('client') || ''
    const userFilter = searchParams.get('user') || ''
    const fromDate = searchParams.get('from') || ''
    const limit = parseInt(searchParams.get('limit') || '200', 10)

    const supabase = createAdminClient()
    let query = supabase
      .from('devis_claudus')
      .select('numero, created_by, client_nom, client_telephone, client_ville, reference, delai, montant_ht, montant_ttc, pdf_path, pdf_filename, created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 1000))

    if (clientFilter) query = query.ilike('client_nom', `%${clientFilter}%`)
    if (userFilter) query = query.eq('created_by', userFilter)
    if (fromDate) query = query.gte('created_at', fromDate)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data || [])
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
