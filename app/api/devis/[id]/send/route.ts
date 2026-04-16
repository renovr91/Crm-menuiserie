import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotifSMS } from '@/lib/ovh-sms'

async function sendEmail(to: string, clientNom: string, reference: string, devisUrl: string) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) throw new Error('RESEND_API_KEY manquante')

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
    <div style="background: #0f172a; padding: 24px;">
      <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em;">RENOV-R 91</h1>
      <p style="color: #94a3b8; margin: 4px 0 0; font-size: 14px;">Votre devis est prêt</p>
    </div>
    <div style="padding: 28px 24px;">
      <p style="font-size: 16px; color: #0f172a; margin: 0 0 16px;">Bonjour ${clientNom},</p>
      <p style="font-size: 15px; color: #334155; line-height: 1.6; margin: 0 0 24px;">
        Votre devis <strong>${reference || ''}</strong> est disponible. Vous pouvez le consulter et le signer en ligne en un clic.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${devisUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Consulter et signer mon devis</a>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 24px 0 0;">
        Ou copiez ce lien dans votre navigateur :<br>
        <a href="${devisUrl}" style="color: #2563eb; word-break: break-all;">${devisUrl}</a>
      </p>
    </div>
    <div style="background: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0;">
      <p style="font-size: 12px; color: #94a3b8; margin: 0; text-align: center;">RENOV-R 91 — Menuiseries</p>
    </div>
  </div>
</body>
</html>`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RENOV-R 91 <contact@renov-r.com>',
      to: [to],
      subject: `Votre devis ${reference || ''} RENOV-R 91`,
      html,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Email error: ${err}`)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  // Lire la méthode (sms, email, both) — défaut sms pour compat
  let method: 'sms' | 'email' | 'both' = 'sms'
  try {
    const body = await request.json()
    if (body?.method) method = body.method
  } catch { /* no body */ }

  const { data: devis, error } = await supabase
    .from('devis')
    .select('*, clients(nom, telephone, email)')
    .eq('id', id)
    .single()
  if (error || !devis) return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })

  const client = devis.clients as { nom: string; telephone: string | null; email: string | null }

  const reqUrl = new URL(request.url)
  const origin = `${reqUrl.protocol}//${reqUrl.host}`
  const devisUrl = `${origin}/d/${devis.token}`
  const smsMessage = `Bonjour ${client.nom}, votre devis ${devis.reference || ''} est disponible. Consultez et signez-le en ligne : ${devisUrl} - RENOV-R 91`

  const results: { sms?: 'ok' | string; email?: 'ok' | string } = {}

  // SMS
  if (method === 'sms' || method === 'both') {
    if (!client.telephone) {
      return NextResponse.json({ error: 'Pas de téléphone client' }, { status: 400 })
    }
    try {
      await sendNotifSMS(client.telephone, smsMessage)
      results.sms = 'ok'
    } catch (err) {
      results.sms = (err as Error).message
      if (method === 'sms') {
        return NextResponse.json({ error: `Erreur SMS: ${results.sms}` }, { status: 500 })
      }
    }
  }

  // Email
  if (method === 'email' || method === 'both') {
    if (!client.email) {
      return NextResponse.json({ error: 'Pas d\'email client' }, { status: 400 })
    }
    try {
      await sendEmail(client.email, client.nom, devis.reference || '', devisUrl)
      results.email = 'ok'
    } catch (err) {
      results.email = (err as Error).message
      if (method === 'email') {
        return NextResponse.json({ error: `Erreur email: ${results.email}` }, { status: 500 })
      }
    }
  }

  // Mettre à jour le devis si au moins un envoi a réussi
  const anySuccess = results.sms === 'ok' || results.email === 'ok'
  if (anySuccess) {
    await supabase.from('devis').update({ status: 'envoye', sent_at: new Date().toISOString() }).eq('id', id)
  }

  return NextResponse.json({ success: anySuccess, results })
}
