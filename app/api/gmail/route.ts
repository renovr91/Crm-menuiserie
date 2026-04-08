import { NextRequest, NextResponse } from 'next/server'
import { fetchLeboncoinEmails, type LeboncoinConversation } from '@/lib/gmail'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 120

// GET: Load saved messages from Supabase
export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('source', 'leboncoin')
    .order('date_email', { ascending: false, nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// POST: Sync from Gmail — fetch new messages, update existing, create clients
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json().catch(() => ({}))
  const action = body.action || 'sync'

  if (action === 'sync') {
    // Fetch from Gmail IMAP
    let conversations: LeboncoinConversation[]
    try {
      conversations = await fetchLeboncoinEmails()
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }

    let imported = 0, updated = 0, skipped = 0

    for (const conv of conversations) {
      // Build full conversation: all messages sorted chronologically (oldest first)
      const chronological = [...conv.messages].sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      )
      const fullMessage = chronological
        .map(m => {
          const d = new Date(m.date)
          const dateStr = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
          const text = m.text || m.fullText || ''
          return `[${dateStr}] ${text}`
        })
        .join('\n---\n')

      // Check if conversation already exists (try exact match, then fuzzy without special chars)
      const normalizedKey = conv.conversationKey.replace(/[''`]/g, '').replace(/\s+/g, ' ').trim()
      let { data: existing } = await supabase
        .from('messages')
        .select('id, message_client, conversation_key')
        .eq('source', 'leboncoin')
        .eq('conversation_key', normalizedKey)
        .single()

      // Fuzzy match: try matching by titre_annonce + similar nom_contact
      if (!existing) {
        const { data: fuzzyMatch } = await supabase
          .from('messages')
          .select('id, message_client, conversation_key')
          .eq('source', 'leboncoin')
          .ilike('conversation_key', `%::${conv.titreAnnonce.toLowerCase()}`)
          .ilike('conversation_key', `${conv.nomContact.toLowerCase().substring(0, 3)}%`)
          .single()
        if (fuzzyMatch) {
          existing = fuzzyMatch
          // Update the old conversation_key to the normalized one
          await supabase.from('messages').update({ conversation_key: normalizedKey }).eq('id', fuzzyMatch.id)
        }
      }

      if (existing) {
        // Update if content changed (compare message count, not length — format may vary)
        const existingMsgCount = (existing.message_client || '').split('\n---\n').length
        const newMsgCount = conv.messages.length
        const contentChanged = newMsgCount > existingMsgCount || fullMessage !== existing.message_client
        if (contentChanged) {
          await supabase.from('messages').update({
            message_client: fullMessage,
            telephone: conv.phone,
            has_attachment: conv.hasAttachment,
            nouveau_message: newMsgCount > existingMsgCount,
          }).eq('id', existing.id)
          updated++
        } else {
          skipped++
        }
        continue
      }

      // Upload attachments to Supabase Storage
      const attachmentUrls: string[] = []
      if (conv.attachments?.length > 0) {
        for (const att of conv.attachments) {
          const path = `${conv.conversationKey.replace(/[^a-z0-9]/g, '_')}/${att.filename}`
          const { error: uploadErr } = await supabase.storage
            .from('pj-leboncoin')
            .upload(path, att.content, { contentType: att.contentType, upsert: true })
          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('pj-leboncoin').getPublicUrl(path)
            attachmentUrls.push(urlData.publicUrl)
          }
        }
      }

      // Insert new conversation
      await supabase.from('messages').insert({
        titre_annonce: conv.titreAnnonce,
        nom_contact: conv.nomContact,
        telephone: conv.phone,
        message_client: fullMessage,
        has_attachment: conv.hasAttachment,
        source: 'leboncoin',
        conversation_key: conv.conversationKey,
        attachments: attachmentUrls.length > 0 ? attachmentUrls : undefined,
      })
      imported++

      // Create client if phone available and not duplicate
      if (conv.phone) {
        const { data: existCli } = await supabase
          .from('clients')
          .select('id')
          .eq('telephone', conv.phone)
          .single()

        if (!existCli) {
          await supabase.from('clients').insert({
            nom: conv.nomContact || 'Contact LeBonCoin',
            telephone: conv.phone,
            source: 'leboncoin',
            notes: `Import auto — Annonce: ${conv.titreAnnonce}\nMessages: ${conv.messages.length}`,
          })
        }
      }
    }

    return NextResponse.json({ imported, updated, skipped, total: conversations.length })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
