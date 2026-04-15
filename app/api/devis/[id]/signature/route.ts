import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// GET — récupérer les preuves de signature d'un devis
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  // Récupérer la signature + OTP lié
  const { data: signature, error } = await supabase
    .from('signatures')
    .select('id, signer_name, signer_ip, document_hash, signed_at, otp_id')
    .eq('devis_id', id)
    .order('signed_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !signature) {
    return NextResponse.json({ signed: false })
  }

  // Récupérer les infos OTP si disponible
  let otp = null
  if (signature.otp_id) {
    const { data } = await supabase
      .from('otp_codes')
      .select('phone, verified, verified_at, created_at')
      .eq('id', signature.otp_id)
      .single()
    otp = data
  }

  return NextResponse.json({
    signed: true,
    signer_name: signature.signer_name,
    signer_ip: signature.signer_ip,
    document_hash: signature.document_hash,
    signed_at: signature.signed_at,
    sms_verified: otp?.verified || false,
    sms_phone: otp?.phone || null,
    sms_sent_at: otp?.created_at || null,
    sms_verified_at: otp?.verified_at || otp?.created_at || null,
  })
}
