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

      // Check if conversation already exists
      const normalizedKey = conv.conversationKey.replace(/[''`]/g, '').replace(/\s+/g, ' ').trim()
      let { data: existing } = await (async () => {
        // 1. BEST: Match by email_contact + titre_annonce (same person same ad)
        if (conv.emailContact) {
          const { data: emailMatch } = await supabase
            .from('messages')
            .select('id, message_client, conversation_key, date_email')
            .eq('source', 'leboncoin')
            .eq('email_contact', conv.emailContact)
            .ilike('titre_annonce', conv.titreAnnonce)
            .order('created_at', { ascending: false })
            .limit(1)
          if (emailMatch && emailMatch.length > 0) {
            await supabase.from('messages').update({
              conversation_key: normalizedKey,
              nom_contact: conv.nomContact,
            }).eq('id', emailMatch[0].id)
            return { data: emailMatch[0] }
          }
        }
        // 2. Exact match on conversation_key
        const { data: exactMatch } = await supabase
          .from('messages')
          .select('id, message_client, conversation_key, date_email')
          .eq('source', 'leboncoin')
          .eq('conversation_key', normalizedKey)
          .limit(1)
        if (exactMatch && exactMatch.length > 0) return { data: exactMatch[0] }
        // 3. Fuzzy: same titre_annonce + similar nom_contact prefix
        const { data: fuzzyMatches } = await supabase
          .from('messages')
          .select('id, message_client, conversation_key, date_email')
          .eq('source', 'leboncoin')
          .ilike('conversation_key', `%::${conv.titreAnnonce.toLowerCase()}`)
          .ilike('conversation_key', `${conv.nomContact.toLowerCase().substring(0, 3)}%`)
          .order('created_at', { ascending: false })
          .limit(1)
        if (fuzzyMatches && fuzzyMatches.length > 0) {
          await supabase.from('messages').update({
            conversation_key: normalizedKey,
            nom_contact: conv.nomContact,
          }).eq('id', fuzzyMatches[0].id)
          return { data: fuzzyMatches[0] }
        }
        return { data: null }
      })()

      if (existing) {
        // Only update if this email is NEWER or LONGER (don't overwrite newer content with older)
        const existingDate = existing.date_email ? new Date(existing.date_email).getTime() : 0
        const newDate = conv.lastDate ? new Date(conv.lastDate).getTime() : 0
        const isNewer = newDate >= existingDate
        const isLonger = fullMessage.length > (existing.message_client?.length || 0)
        const isDifferent = fullMessage !== existing.message_client

        if ((isNewer || isLonger) && isDifferent) {
          await supabase.from('messages').update({
            message_client: fullMessage,
            date_email: isNewer ? conv.lastDate.toISOString() : undefined,
            telephone: conv.phone || undefined,
            has_attachment: conv.hasAttachment || undefined,
            nouveau_message: isLonger,
            email_contact: conv.emailContact || undefined,
            ...(conv.phoneContext ? { phone_context: conv.phoneContext } : {}),
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
        phone_context: conv.phoneContext,
        message_client: fullMessage,
        has_attachment: conv.hasAttachment,
        source: 'leboncoin',
        conversation_key: normalizedKey,
        email_contact: conv.emailContact,
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
