import { NextRequest, NextResponse } from 'next/server'
import {
  listConversations,
  getMessages,
  getConversationDetails,
  sendMessage,
  markAsRead,
  getUnreadCount,
  getAdInfo,
} from '@/lib/lbc-messaging'

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
        const page = parseInt(searchParams.get('page') || '1')
        const data = await listConversations(page)
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

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[LBC Messaging]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
