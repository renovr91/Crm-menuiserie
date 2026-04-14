import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { code } = await request.json()
  const supabase = createAdminClient()

  // Trouver le devis
  const { data: devis, error } = await supabase
    .from('devis')
    .select('id')
    .eq('token', token)
    .single()

  if (error || !devis) {
    return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })
  }

  // Chercher le dernier OTP non expiré pour ce devis
  const { data: otp } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('devis_id', devis.id)
    .eq('verified', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!otp) {
    return NextResponse.json({ error: 'Code expiré. Demandez un nouveau code.' }, { status: 400 })
  }

  // Max 5 tentatives par code
  if (otp.attempts >= 5) {
    return NextResponse.json({ error: 'Trop de tentatives. Demandez un nouveau code.' }, { status: 429 })
  }

  // Incrémenter tentatives
  await supabase
    .from('otp_codes')
    .update({ attempts: otp.attempts + 1 })
    .eq('id', otp.id)

  // Vérifier le code
  if (otp.code !== code.trim()) {
    return NextResponse.json({ error: 'Code incorrect' }, { status: 400 })
  }

  // Marquer comme vérifié
  await supabase
    .from('otp_codes')
    .update({ verified: true })
    .eq('id', otp.id)

  return NextResponse.json({ success: true, otp_id: otp.id })
}
