import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Masque (ou réaffiche) un envoi dans le panneau Signatures.
 *
 * ⚠️ Purement LOCAL : on écrit un drapeau dans notre base, le document reste
 * intact chez DocuSeal. Aucun appel à l'API DocuSeal, donc aucun risque de
 * supprimer une preuve de signature. Réversible (masque: false).
 */
export async function POST(request: NextRequest) {
  const { submission_id, masque = true, numero } = await request.json()
  const id = Number(submission_id)
  if (!id) return NextResponse.json({ error: 'submission_id requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('devis_signatures').upsert(
    {
      submission_id: id,
      numero: numero ?? null,
      masque: !!masque,
      masque_le: masque ? new Date().toISOString() : null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'submission_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, submission_id: id, masque: !!masque })
}
