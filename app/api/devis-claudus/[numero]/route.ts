import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// GET /api/devis-claudus/[numero]
// Détail complet d'un devis (lignes, livraison, pose, etc.)
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ numero: string }> }
) {
  const { numero } = await context.params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('devis_claudus')
    .select('*')
    .eq('numero', numero)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}
