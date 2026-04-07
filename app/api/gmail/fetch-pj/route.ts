import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { messageId } = await request.json()
  if (!messageId) return NextResponse.json({ error: 'messageId requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Get message info
  const { data: msg } = await supabase
    .from('messages')
    .select('id, conversation_key, gmail_id_pj, gmail_id, attachments')
    .eq('id', messageId)
    .single()

  if (!msg) return NextResponse.json({ error: 'Message non trouvé' }, { status: 404 })

  const gmailUid = msg.gmail_id_pj || msg.gmail_id
  if (!gmailUid) return NextResponse.json({ error: 'Pas de gmail_id pour ce message' }, { status: 400 })

  // Connect to Gmail IMAP
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER!,
      pass: process.env.GMAIL_APP_PASSWORD!,
    },
    logger: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      // Fetch the specific email by UID
      const fetchResult = client.fetch(gmailUid, { source: true }, { uid: true })
      let source: Buffer | undefined

      for await (const fetched of fetchResult) {
        source = fetched.source
        break
      }

      if (!source) {
        return NextResponse.json({ error: 'Email non trouvé dans Gmail' }, { status: 404 })
      }

      const parsed = await simpleParser(source)

      // Filter real attachments (images/PDFs, not tracking pixels)
      const realAttachments = (parsed.attachments || []).filter(
        a => !a.contentType?.includes('text') && (a.size || 0) > 500
      )

      if (realAttachments.length === 0) {
        return NextResponse.json({ error: 'Aucune PJ trouvée dans cet email', count: 0 })
      }

      const folder = (msg.conversation_key || 'unknown').replace(/[^a-z0-9]/g, '_')
      const uploadedUrls: string[] = []
      const currentAttach = Array.isArray(msg.attachments) ? [...msg.attachments] : []

      for (const att of realAttachments) {
        const filename = att.filename || `photo_${Date.now()}.jpg`
        const ext = filename.split('.').pop() || 'jpg'
        const path = `${folder}/pj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`

        const { error: uploadErr } = await supabase.storage
          .from('pj-leboncoin')
          .upload(path, att.content, { contentType: att.contentType || 'image/jpeg', upsert: true })

        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('pj-leboncoin').getPublicUrl(path)
          uploadedUrls.push(urlData.publicUrl)
        }
      }

      // Update message with attachment URLs
      if (uploadedUrls.length > 0) {
        const allAttach = [...currentAttach, ...uploadedUrls]
        await supabase.from('messages').update({
          attachments: allAttach,
          has_attachment: true,
        }).eq('id', msg.id)
      }

      return NextResponse.json({
        success: true,
        count: uploadedUrls.length,
        urls: uploadedUrls,
      })
    } finally {
      lock.release()
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  } finally {
    await client.logout().catch(() => {})
  }
}
