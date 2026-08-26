import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Émet un brouillon : lui attribue son numéro séquentiel et le fige
 * (chaînage par hash). ⚠️ IRRÉVERSIBLE — une facture émise ne peut plus être
 * supprimée, seulement annulée par un avoir.
 */
export async function POST(request: NextRequest) {
  const { facture_id, acteur } = await request.json()
  if (!facture_id) return NextResponse.json({ error: 'facture_id requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: numero, error } = await supabase.rpc('facture_emettre', {
    p_id: facture_id,
    p_acteur: acteur || 'CRM',
  })
  // Les messages du moteur sont explicites (client incomplet, TVA invalide…) :
  // on les remonte tels quels, ils disent quoi corriger.
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true, numero })
}
