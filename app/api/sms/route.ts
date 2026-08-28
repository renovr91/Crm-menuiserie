import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotifSMS } from '@/lib/ovh-sms'

export const dynamic = 'force-dynamic'

/**
 * Envoi de SMS depuis le CRM (page /sms) + journal.
 * Route PROTÉGÉE par le middleware (absente de PUBLIC_PATHS) : seuls les
 * utilisateurs connectés au CRM (Yacine, assistante…) peuvent envoyer.
 * L'expéditeur est piloté par OVH_SMS_SENDER (alphanumérique validé côté OVH).
 */
export async function POST(request: NextRequest) {
  const b = await request.json()
  const telephone = String(b.telephone || '').replace(/[\s.-]/g, '')
  const message = String(b.message || '').trim()

  if (!/^(\+33|0033|0)[67]\d{8}$/.test(telephone)) {
    return NextResponse.json({ error: 'numéro mobile français invalide (06/07)' }, { status: 400 })
  }
  if (!message) return NextResponse.json({ error: 'message vide' }, { status: 400 })
  if (message.length > 918) {
    return NextResponse.json({ error: 'message trop long (max 918 caractères = 6 SMS)' }, { status: 400 })
  }

  const supabase = createAdminClient()
  let statut = 'envoye'
  let erreur: string | null = null
  let credits: number | null = null
  let tag: string | null = null
  try {
    const res = await sendNotifSMS(telephone, message)
    credits = typeof res?.totalCreditsRemoved === 'number' ? res.totalCreditsRemoved : null
    // OVH renvoie le même tag sur la réponse du client → permet de la rattacher
    tag = typeof res?.tag === 'string' ? res.tag : null
  } catch (e) {
    statut = 'erreur'
    erreur = e instanceof Error ? e.message.slice(0, 300) : 'erreur inconnue'
  }

  await supabase.from('sms_envoyes').insert({
    telephone,
    message,
    envoye_par: b.envoye_par ? String(b.envoye_par).slice(0, 40) : null,
    client_nom: b.client_nom ? String(b.client_nom).slice(0, 80) : null,
    statut,
    erreur,
    credits,
    tag,
  })

  if (statut === 'erreur') return NextResponse.json({ error: erreur }, { status: 502 })
  return NextResponse.json({ ok: true, credits })
}

/** Historique des envois (50 derniers). */
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('sms_envoyes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sms: data || [] })
}
