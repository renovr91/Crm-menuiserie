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
      // Use the LATEST email's full body — it contains the complete conversation
      // (client messages + SENROLL replies with names and dates in "Messages précédents")
      const sorted = [...conv.messages].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )
      const fullMessage = sorted[0]?.fullText || sorted[0]?.text || ''

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
          await supabase.from('messages').update({ conversation_key: normalizedKey }).eq('id', fuzzyMatch.id)
        }
      }

      if (existing) {
        // Always update if content changed (new messages in conversation)
        if (fullMessage.length > (existing.message_client?.length || 0) || fullMessage !== existing.message_client) {
          await supabase.from('messages').update({
            message_client: fullMessage,
            telephone: conv.phone,
            has_attachment: conv.hasAttachment,
            nouveau_message: fullMessage.length > (existing.message_client?.length || 0),
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
