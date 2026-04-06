import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const { devis_id, signature_data } = await request.json()

  const { data: devis, error } = await supabase.from('devis').select('id, status, lignes, montant_ht, montant_ttc').eq('id', devis_id).single()
  if (error || !devis) return NextResponse.json({ error: 'Devis non trouv\u00e9' }, { status: 404 })
  if (devis.status === 'signe') return NextResponse.json({ error: 'Devis d\u00e9j\u00e0 sign\u00e9' }, { status: 400 })

  const documentContent = JSON.stringify({ id: devis.id, lignes: devis.lignes, montant_ht: devis.montant_ht, montant_ttc: devis.montant_ttc })
  const documentHash = crypto.createHash('sha256').update(documentContent).digest('hex')

  const signerIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'

  const { error: sigError } = await supabase.from('signatures').insert({ devis_id, signature_data, signer_ip: signerIp, document_hash: documentHash })
  if (sigError) return NextResponse.json({ error: sigError.message }, { status: 500 })

  await supabase.from('devis').update({ status: 'signe', signed_at: new Date().toISOString() }).eq('id', devis_id)
  return NextResponse.json({ success: true, document_hash: documentHash })
}
