/**
 * POST /api/lbc-messaging/auto-reply-check
 *
 * Appelé par le Chrome Bridge après un upsert lbc_messages.
 * Vérifie 3 garde-fous puis insère une auto-réponse dans lbc_outbox.
 *
 * Auth : header `Authorization: Bearer <LBC_AUTO_REPLY_SECRET>`.
 * Cet endpoint est ajouté à PUBLIC_PATHS du middleware (pas d'auth user Supabase).
 *
 * Body : { conversation_id: string }
 * Return : { triggered: boolean, reason: 'ok' | 'disabled' | 'not_found' | 'not_first_msg' | 'no_match' | 'already_replied' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const TRIGGER_SUBSTRING = 'toujours disponible'

interface LbcMessage {
  text?: string
  isMe?: boolean
  is_me?: boolean
  [key: string]: unknown
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  // 1. Auth bearer token
  const expected = process.env.LBC_AUTO_REPLY_SECRET
  if (!expected) {
    console.error('[auto-reply] LBC_AUTO_REPLY_SECRET not set')
    return unauthorized()
  }
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${expected}`) {
    return unauthorized()
  }

  // 2. Parse body
  let body: { conversation_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const conversation_id = typeof body.conversation_id === 'string' ? body.conversation_id.trim() : ''
  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
  }

  // 3. Kill switch
  if (process.env.LBC_AUTO_REPLY_ENABLED !== 'true') {
    console.log(`[auto-reply] conv=${conversation_id} reason=disabled`)
    return NextResponse.json({ triggered: false, reason: 'disabled' })
  }

  const sb = createAdminClient()

  try {
    // 4. Charger la conversation
    const { data: row, error: selErr } = await sb
      .from('lbc_messages')
      .select('messages')
      .eq('conversation_id', conversation_id)
      .maybeSingle()

    if (selErr) {
      console.error('[auto-reply] select lbc_messages error:', selErr.message)
      return NextResponse.json({ error: selErr.message }, { status: 500 })
    }

    if (!row) {
      console.log(`[auto-reply] conv=${conversation_id} reason=not_found`)
      return NextResponse.json({ triggered: false, reason: 'not_found' })
    }

    const rawMessages = row.messages
    const messages: LbcMessage[] = Array.isArray(rawMessages) ? (rawMessages as LbcMessage[]) : []

    // 5. Garde-fou : doit être un seul message envoyé par l'acheteur
    if (messages.length !== 1) {
      console.log(
        `[auto-reply] conv=${conversation_id} reason=not_first_msg (length=${messages.length})`,
      )
      return NextResponse.json({ triggered: false, reason: 'not_first_msg' })
    }
    const m = messages[0]
    const isMe = m.isMe === true || m.is_me === true
    if (isMe) {
      console.log(`[auto-reply] conv=${conversation_id} reason=not_first_msg (is_me)`)
      return NextResponse.json({ triggered: false, reason: 'not_first_msg' })
    }

    // 6. Garde-fou : pattern substring
    const text = (m.text || '').toLowerCase().trim()
    if (!text.includes(TRIGGER_SUBSTRING)) {
      console.log(`[auto-reply] conv=${conversation_id} reason=no_match`)
      return NextResponse.json({ triggered: false, reason: 'no_match' })
    }

    // 7. Garde-fou : déjà une entrée outbox active ?
    const { count, error: cntErr } = await sb
      .from('lbc_outbox')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversation_id)
      .in('status', ['pending', 'sent'])
    if (cntErr) {
      console.error('[auto-reply] count outbox error:', cntErr.message)
      return NextResponse.json({ error: cntErr.message }, { status: 500 })
    }
    if ((count ?? 0) > 0) {
      console.log(`[auto-reply] conv=${conversation_id} reason=already_replied`)
      return NextResponse.json({ triggered: false, reason: 'already_replied' })
    }

    // 8. INSERT auto-reply
    const replyText =
      process.env.LBC_AUTO_REPLY_TEXT ||
      `Bonjour, merci pour votre message !\n\nPourriez-vous m'indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !`

    const { error: insErr } = await sb.from('lbc_outbox').insert({
      conversation_id,
      text: replyText,
      status: 'pending',
    })
    if (insErr) {
      // Si l'index unique a empêché un double-fire, on retourne already_replied proprement
      if (insErr.code === '23505') {
        console.log(`[auto-reply] conv=${conversation_id} reason=already_replied (race)`)
        return NextResponse.json({ triggered: false, reason: 'already_replied' })
      }
      console.error('[auto-reply] insert outbox error:', insErr.message)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    console.log(`[auto-reply] conv=${conversation_id} reason=ok text-len=${replyText.length}`)
    return NextResponse.json({ triggered: true, reason: 'ok' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[auto-reply] unexpected error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
