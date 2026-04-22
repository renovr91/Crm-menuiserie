import { NextRequest, NextResponse } from 'next/server'
import {
  listConversations,
  getMessages,
  getConversationDetails,
  sendMessage,
  sendAttachment,
  markAsRead,
  getUnreadCount,
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
        const pageHash = searchParams.get('pageHash') || undefined
        const data = await listConversations(pageHash)
        return NextResponse.json(data)
      }

      case 'messages': {
        const conv = searchParams.get('conv')
        if (!conv) return NextResponse.json({ error: 'conv required' }, { status: 400 })
        const page = parseInt(searchParams.get('page') || '1')
        const data = await getMessages(conv, page)
        return NextResponse.json(data)
      }

      case 'details': {
        const conv = searchParams.get('conv')
        if (!conv) return NextResponse.json({ error: 'conv required' }, { status: 400 })
        const data = await getConversationDetails(conv)
        return NextResponse.json(data)
      }

      case 'unread': {
        const data = await getUnreadCount()
        return NextResponse.json(data)
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
        const data = await sendMessage(conv, text)
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
        }
        return NextResponse.json(data)
      }

      case 'read': {
        const { conv, messageId } = body
        if (!conv || !messageId) {
          return NextResponse.json({ error: 'conv and messageId required' }, { status: 400 })
        }
        await markAsRead(conv, messageId)
        return NextResponse.json({ ok: true })
      }

      case 'find-relay-email': {
        const { conv, contactName, adTitle } = body
        if (!conv || !contactName) {
          return NextResponse.json({ error: 'conv and contactName required' }, { status: 400 })
        }
        const { findRelayEmail } = await getRelayModules()
        const relayEmail = await findRelayEmail(conv, contactName, adTitle)
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
