import { NextRequest, NextResponse } from 'next/server'
import {
  sendAttachment,
  getAdInfo,
} from '@/lib/lbc-messaging'
import { getCurrentCommercial } from '@/lib/get-commercial'
import { logActivity } from '@/lib/activity-log'
// Dynamic imports to avoid crashing the route if imapflow/nodemailer fail to load
// These are only needed for relay email actions, not for message loading
const getRelayModules = async () => {
  const [relayFind, relaySend] = await Promise.all([
    import('@/lib/find-relay-email'),
    import('@/lib/send-relay-email'),
  ])
  return {
    findRelayEmail: relayFind.findRelayEmail,
    saveRelayEmailToDB: relayFind.saveRelayEmailToDB,
    getRelayEmailFromDB: relayFind.getRelayEmailFromDB,
    sendRelayEmail: relaySend.sendRelayEmail,
  }
}

/**
 * GET /api/lbc-messaging
 *
 * Query params:
 *   action=conversations          → List all conversations
 *   action=messages&conv=UUID     → Get messages for a conversation
 *   action=details&conv=UUID      → Get conversation details
 *   action=unread                 → Get unread count
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') || 'conversations'

    switch (action) {
      case 'conversations': {
        // Lire depuis Supabase (rempli par le bridge Chrome Tampermonkey)
        // Plus de relay VPS = plus de Hyper-SDK
        const { createAdminClient } = await import('@/lib/supabase')
        const supabase = createAdminClient()
        const { data: leads } = await supabase
          .from('lbc_leads')
          .select('*')
          .order('dernier_message_date', { ascending: false, nullsFirst: false })
        return NextResponse.json({ conversations: leads || [], source: 'chrome_bridge' })
      }

      case 'messages': {
        const conv = searchParams.get('conv')
        if (!conv) return NextResponse.json({ error: 'conv required' }, { status: 400 })
        // Lire depuis Supabase (rempli par le bridge Chrome Tampermonkey)
        const { createAdminClient } = await import('@/lib/supabase')
        const supabase = createAdminClient()
        const { data: cached } = await supabase
          .from('lbc_messages')
          .select('messages, updated_at')
          .eq('conversation_id', conv)
          .single()
        if (cached && cached.messages) {
          return NextResponse.json({
            messages: cached.messages,
            source: 'chrome_bridge',
            cached_at: cached.updated_at,
          })
        }
        // Pas de fallback relay — tout passe par le bridge Chrome
        return NextResponse.json({
          messages: [],
          source: 'none',
          error: 'Messages pas encore synchronisés. Ouvrez leboncoin.fr dans Chrome pour activer le bridge.',
        })
      }

      case 'details': {
        const conv = searchParams.get('conv')
        if (!conv) return NextResponse.json({ error: 'conv required' }, { status: 400 })
        // Lire depuis Supabase
        const { createAdminClient: createAdmin2 } = await import('@/lib/supabase')
        const sb2 = createAdmin2()
        const { data: lead } = await sb2
          .from('lbc_leads')
          .select('*')
          .eq('conversation_id', conv)
          .single()
        return NextResponse.json(lead || { error: 'not found' })
      }

      case 'unread': {
        // Compter depuis Supabase au lieu du relay
        const { createAdminClient } = await import('@/lib/supabase')
        const supabase = createAdminClient()
        const { data: unreadLeads } = await supabase
          .from('lbc_leads')
          .select('unread_count')
          .gt('unread_count', 0)
        const total = (unreadLeads || []).reduce((sum: number, l: any) => sum + (l.unread_count || 0), 0)
        return NextResponse.json({ unreadCount: total, source: 'chrome_bridge' })
      }

      case 'adinfo': {
        const adId = searchParams.get('adId')
        if (!adId) return NextResponse.json({ error: 'adId required' }, { status: 400 })
        const data = await getAdInfo(adId)
        return NextResponse.json(data || { error: 'not found' })
      }

      case 'attachment': {
        const path = searchParams.get('path')
        const conv = searchParams.get('conv') || ''
        if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
        const { getAttachment } = await import('@/lib/lbc-messaging')
        const result = await getAttachment(path, conv)
        if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 })
        // Si c'est une URL signée, rediriger
        if ('redirect' in result) {
          return NextResponse.json({ redirect: (result as any).redirect })
        }
        return new NextResponse(result.data, {
          status: 200,
          headers: {
            'Content-Type': result.contentType,
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[LBC Messaging]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/lbc-messaging
 *
 * Body:
 *   action=send     → { conv: UUID, text: string }
 *   action=read     → { conv: UUID, messageId: UUID }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'send': {
        const { conv, text } = body
        if (!conv || !text) {
          return NextResponse.json({ error: 'conv and text required' }, { status: 400 })
        }
        // Écrire dans l'outbox Supabase — le bridge Chrome enverra le message
        const { createAdminClient } = await import('@/lib/supabase')
        const supabase = createAdminClient()
        const { data: outboxEntry, error: outboxErr } = await supabase
          .from('lbc_outbox')
          .insert({ conversation_id: conv, text, status: 'pending' })
          .select()
          .single()
        if (outboxErr) {
          return NextResponse.json({ error: outboxErr.message }, { status: 500 })
        }
        const me = await getCurrentCommercial()
        if (me) {
          await logActivity({
            commercial_id: me.id,
            user_id: me.user_id,
            action_type: 'message_sent',
            entity_type: 'message_lbc',
            entity_id: conv,
            details: { text_preview: text.substring(0, 100) },
          })
          await supabase.from('lbc_leads').update({ dernier_commercial: me.nom || 'Inconnu' }).eq('conversation_id', conv)
        }
        return NextResponse.json({ ok: true, outbox_id: outboxEntry.id, status: 'pending', commercial: me?.nom })
      }

      case 'read': {
        // markAsRead via relay supprimé — le bridge Chrome gère la lecture
        // On met juste à jour le unread_count dans Supabase
        const { conv } = body
        if (!conv) {
          return NextResponse.json({ error: 'conv required' }, { status: 400 })
        }
        const { createAdminClient: createAdmin3 } = await import('@/lib/supabase')
        const sb3 = createAdmin3()
        await sb3.from('lbc_leads').update({ unread_count: 0 }).eq('conversation_id', conv)
        return NextResponse.json({ ok: true })
      }

      case 'find-relay-email': {
        const { conv, contactName, firstMessageText } = body
        if (!conv || !firstMessageText) {
          return NextResponse.json({ error: 'conv et firstMessageText requis' }, { status: 400 })
        }
        const { findRelayEmail } = await getRelayModules()
        const relayEmail = await findRelayEmail(conv, contactName || '', firstMessageText)
        return NextResponse.json({ relayEmail })
      }

      case 'save-relay-email': {
        const { conv, relayEmail } = body
        if (!conv || !relayEmail) {
          return NextResponse.json({ error: 'conv and relayEmail required' }, { status: 400 })
        }
        const { saveRelayEmailToDB } = await getRelayModules()
        await saveRelayEmailToDB(conv, relayEmail)
        return NextResponse.json({ ok: true })
      }

      case 'get-relay-email': {
        const { conv } = body
        if (!conv) {
          return NextResponse.json({ error: 'conv required' }, { status: 400 })
        }
        const { getRelayEmailFromDB } = await getRelayModules()
        const relayEmail = await getRelayEmailFromDB(conv)
        return NextResponse.json({ relayEmail })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[LBC Messaging]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * PUT /api/lbc-messaging — Send attachment via email relay
 * FormData: conv, file, relayEmail, subject (optional), text (optional)
 *
 * If relayEmail is provided, sends via Gmail SMTP to the LBC relay email.
 * Falls back to LBC API attachment endpoint if no relayEmail.
 */
export async function PUT(req: NextRequest) {
  try {
    const formData = await req.formData()
    const conv = formData.get('conv') as string | null
    const file = formData.get('file') as File | null
    const relayEmail = formData.get('relayEmail') as string | null
    const subject = formData.get('subject') as string | null
    const text = formData.get('text') as string | null

    if (!conv || !file) {
      return NextResponse.json({ error: 'conv and file required' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    let data: any

    if (relayEmail && relayEmail.includes('@messagerie.leboncoin.fr')) {
      // Send via Gmail SMTP to LBC relay email (dynamic import)
      const { sendRelayEmail } = await getRelayModules()
      const result = await sendRelayEmail({
        relayEmail,
        subject: subject || 'Pièce jointe',
        text: text || 'Veuillez trouver ci-joint le document demandé.',
        attachment: {
          filename: file.name,
          content: Buffer.from(arrayBuffer),
          contentType: file.type || 'application/octet-stream',
        },
      })

      if (!result.success) {
        throw new Error(result.error || 'Erreur envoi email')
      }

      data = { ok: true, method: 'email-relay', messageId: result.messageId }
    } else {
      // Fallback: try LBC API attachment endpoint
      data = await sendAttachment(conv, new Uint8Array(arrayBuffer), file.name, file.type || 'application/octet-stream')
      data.method = 'lbc-api'
    }

    const me = await getCurrentCommercial()
    if (me) {
      await logActivity({
        commercial_id: me.id,
        user_id: me.user_id,
        action_type: 'message_sent',
        entity_type: 'message_lbc',
        entity_id: conv,
        details: {
          attachment: file.name,
          type: file.type,
          size: file.size,
          method: relayEmail ? 'email-relay' : 'lbc-api',
        },
      })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[LBC Messaging Attachment]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
