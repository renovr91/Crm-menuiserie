import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { to, subject, message, messageId } = await request.json()

  if (!to || !message) {
    return NextResponse.json({ error: 'to et message requis' }, { status: 400 })
  }

  // 1. Send via n8n webhook (Gmail)
  try {
    const res = await fetch('https://renovr91.app.n8n.cloud/webhook/lbc-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, message }),
    })
    if (!res.ok) throw new Error('n8n webhook failed: ' + res.status)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  // 2. Save reply in Supabase
  if (messageId) {
    const supabase = createAdminClient()
    const { data: msg } = await supabase
      .from('messages')
      .select('reponse_generee')
      .eq('id', messageId)
      .single()

    if (msg) {
      const previousReplies = msg.reponse_generee || ''
      const timestamp = new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      const newReply = `[${timestamp}] SENROLL: ${message}`
      const allReplies = previousReplies ? previousReplies + '\n---\n' + newReply : newReply

      await supabase
        .from('messages')
        .update({ reponse_generee: allReplies, reponse_envoyee: true })
        .eq('id', messageId)
    }
  }

  return NextResponse.json({ success: true })
}
