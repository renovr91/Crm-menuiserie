import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '' // fallback admin

async function sendTelegram(chatId: string, text: string) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function GET() {
  const supabase = createAdminClient()

  // Find tasks with rappel_at <= now AND not yet sent AND not done
  const { data: taches, error } = await supabase
    .from('taches')
    .select('*, clients(nom), commerciaux(nom, telegram_chat_id)')
    .eq('fait', false)
    .eq('rappel_sent', false)
    .not('rappel_at', 'is', null)
    .lte('rappel_at', new Date().toISOString())

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!taches || taches.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  let sent = 0
  for (const t of taches) {
    const clientName = (t.clients as { nom: string } | null)?.nom
    const commercial = t.commerciaux as { nom: string; telegram_chat_id: string | null } | null
    const commercialName = commercial?.nom
    // Send to the commercial's chat_id, fallback to admin
    const chatId = commercial?.telegram_chat_id || TELEGRAM_CHAT_ID

    if (!chatId) continue

    let msg = `🔔 <b>Rappel tâche</b>\n\n`
    msg += `📋 <b>${t.titre}</b>\n`
    if (t.note) msg += `📝 ${t.note}\n`
    if (commercialName) msg += `👤 ${commercialName}\n`
    if (clientName) msg += `🏠 Client : ${clientName}\n`

    const ok = await sendTelegram(chatId, msg)
    if (ok) {
      await supabase.from('taches').update({ rappel_sent: true }).eq('id', t.id)
      sent++
    }
  }

  return NextResponse.json({ sent, total: taches.length })
}
