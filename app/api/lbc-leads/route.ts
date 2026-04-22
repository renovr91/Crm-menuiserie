import { NextRequest, NextResponse } from 'next/server'
import {
  syncConversationsToLeads,
  getLeads,
  updateLeadStatus,
  updateLeadNotes,
  updateLeadPhone,
  resetUnreadCount,
  getTemplates,
  type LeadStatut,
} from '@/lib/lbc-leads'
import { classifyMessage } from '@/lib/classifier'
import { getCurrentCommercial } from '@/lib/get-commercial'
import { logActivity } from '@/lib/activity-log'

/**
 * GET /api/lbc-leads
 *
 * Query params:
 *   statut=nouveau|repondu|...   → Filtrer par statut
 *   departement=75|92|...        → Filtrer par département
 *   search=texte                 → Recherche libre
 *   action=templates             → Charger les templates de réponse
 *   action=classify              → Classifier un message (titre + message en query params)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    if (action === 'templates') {
      const templates = await getTemplates()
      return NextResponse.json({ templates })
    }

    if (action === 'classify') {
      const titre = searchParams.get('titre') || ''
      const message = searchParams.get('message') || ''
      const hasAttachment = searchParams.get('hasAttachment') === 'true'
      if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })
      const result = await classifyMessage(titre, message, hasAttachment)
      return NextResponse.json(result)
    }

    // Par défaut : lister les leads
    const statut = searchParams.get('statut') as LeadStatut | null
    const departement = searchParams.get('departement') || undefined
    const search = searchParams.get('search') || undefined

    const data = await getLeads({
      statut: statut || undefined,
      departement,
      search,
    })

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[LBC Leads GET]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/lbc-leads
 *
 * Body:
 *   action=sync              → Synchroniser conversations LBC → Supabase
 *   action=update-status     → { conversationId, statut, note? }
 *   action=update-notes      → { conversationId, notes }
 *   action=update-phone      → { conversationId, telephone }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'sync': {
        const result = await syncConversationsToLeads()
        return NextResponse.json(result)
      }

      case 'update-status': {
        const { conversationId, statut, note } = body
        if (!conversationId || !statut) {
          return NextResponse.json({ error: 'conversationId and statut required' }, { status: 400 })
        }
        await updateLeadStatus(conversationId, statut as LeadStatut, note)
        const me = await getCurrentCommercial()
        if (me) {
          await logActivity({
            commercial_id: me.id,
            user_id: me.user_id,
            action_type: 'lead_status_change',
            entity_type: 'lead_lbc',
            entity_id: conversationId,
            details: { statut, note, contact_name: body.contact_name },
          })
        }
        return NextResponse.json({ ok: true })
      }

      case 'update-notes': {
        const { conversationId, notes } = body
        if (!conversationId) {
          return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
        }
        await updateLeadNotes(conversationId, notes || '')
        const me2 = await getCurrentCommercial()
        if (me2) {
          await logActivity({
            commercial_id: me2.id,
            user_id: me2.user_id,
            action_type: 'lead_note_update',
            entity_type: 'lead_lbc',
            entity_id: conversationId,
            details: { notes },
          })
        }
        return NextResponse.json({ ok: true })
      }

      case 'update-phone': {
        const { conversationId, telephone } = body
        if (!conversationId) {
          return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
        }
        await updateLeadPhone(conversationId, telephone || '')
        return NextResponse.json({ ok: true })
      }

      case 'reset-unread': {
        const { conversationId } = body
        if (!conversationId) {
          return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
        }
        await resetUnreadCount(conversationId)
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    console.error('[LBC Leads POST]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
