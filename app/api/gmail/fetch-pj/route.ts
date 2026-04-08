import { NextRequest, NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const { messageId, rfcMessageId, gmailHexId } = await request.json()
  if (!messageId) return NextResponse.json({ error: 'messageId requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Get message info
  const { data: msg } = await supabase
    .from('messages')
    .select('id, conversation_key, gmail_id_pj, gmail_id, attachments, message_client')
    .eq('id', messageId)
    .single()

  if (!msg) return NextResponse.json({ error: 'Message non trouvé' }, { status: 404 })

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

    // List mailboxes to find All Mail
    const mailboxes = await client.list()
    let allMailPath = 'INBOX'
    for (const mb of mailboxes) {
      if (mb.specialUse === '\\All' || mb.path?.includes('All Mail') || mb.path?.includes('Tous les messages')) {
        allMailPath = mb.path
        break
      }
    }
    const lock = await client.getMailboxLock(allMailPath)

    try {
      let uids: number[] = []
      let strategyUsed = 'none'
      const gmailId = msg.gmail_id_pj || msg.gmail_id

      // Strategy 0: Direct gmail hex ID provided
      if (gmailHexId) {
        try {
          const decimalId = BigInt('0x' + gmailHexId).toString()
          const searchResult = await client.search({ 'X-GM-MSGID': decimalId } as Record<string, unknown>)
          uids = Array.isArray(searchResult) ? searchResult : Array.from(searchResult as unknown as Iterable<number>)
        } catch { /* X-GM-MSGID not supported */ }
      }

      // Strategy 1: Search by Gmail X-GM-MSGID from DB
      if (uids.length === 0 && gmailId) {
        try {
          const decimalId = BigInt('0x' + gmailId).toString()
          const searchResult = await client.search({ 'X-GM-MSGID': decimalId } as Record<string, unknown>)
          uids = Array.isArray(searchResult) ? searchResult : Array.from(searchResult as unknown as Iterable<number>)
        } catch { /* X-GM-MSGID not supported */ }
      }

      // Strategy 2: Search by RFC Message-ID if provided
      if (uids.length === 0 && rfcMessageId) {
        const searchResult = await client.search({ header: { 'Message-ID': rfcMessageId } })
        uids = searchResult as number[]
      }

      // Strategy 3: Search by subject
      if (uids.length === 0) {
        const annonce = (msg.conversation_key || '').split('::')[1] || ''
        if (annonce) {
          const searchResult = await client.search({ subject: annonce })
          uids = searchResult as number[]
        }
      }

      if (uids.length === 0) {
        return NextResponse.json({ error: 'Aucun email trouvé', debug: { convKey: msg.conversation_key, gmailId, mailbox: allMailPath }, count: 0 })
      }

      const folder = (msg.conversation_key || 'unknown').replace(/[^a-z0-9]/g, '_')
      const uploadedUrls: string[] = []
      const currentAttach = Array.isArray(msg.attachments) ? [...msg.attachments] : []

      const debugInfo: unknown[] = []

      // Ensure uids is an array
      const uidArray = Array.isArray(uids) ? uids : Array.from(uids as Iterable<number>)

      // Try each found email (most recent first)
      for (const uid of uidArray.reverse().slice(0, 5)) {
        const fetchResult = client.fetch(uid, { source: true }, { uid: true })
        let source: Buffer | undefined

        for await (const fetched of fetchResult) {
          source = fetched.source
          break
        }

        if (!source) continue

        const parsed = await simpleParser(source)

        // Debug: check raw MIME - look deeper
        const rawStr = source.toString('utf-8')
        const boundaryMatch = rawStr.match(/boundary="([^"]+)"/i)
        const contentTypes = rawStr.match(/Content-Type:\s*[^\r\n]+/gi) || []
        const contentDisps = rawStr.match(/Content-Disposition:\s*[^\r\n]+/gi) || []
        const hasDefault = rawStr.includes('default')
        const hasImageJpeg = rawStr.toLowerCase().includes('image/jpeg')

        const allAttachments = parsed.attachments || []
        debugInfo.push({
          uid,
          subject: parsed.subject || '?',
          attachmentCount: allAttachments.length,
          attachments: allAttachments.map(a => ({
            filename: a.filename || '(none)',
            contentType: a.contentType || '?',
            size: a.size || 0,
            disposition: ((a as unknown as Record<string, unknown>).contentDisposition as string) || '?',
          })),
          rawMime: { boundary: boundaryMatch?.[1] || null, contentTypes: contentTypes.slice(0, 10), contentDisps: contentDisps.slice(0, 10), sourceSize: source.length, hasDefault, hasImageJpeg, first200: rawStr.substring(0, 200) },
        } as typeof debugInfo[0])

        const realAttachments = allAttachments.filter(a => {
          if (a.contentType?.startsWith('image/') && (a.size || 0) > 500) return true
          if (a.filename === 'default' && (a.size || 0) > 500) return true
          if (!a.contentType?.includes('text') && (a.size || 0) > 1000) return true
          return false
        })

        if (realAttachments.length === 0) continue

        for (const att of realAttachments) {
          const filename = att.filename || `pj_${Date.now()}`
          const ext = att.contentType?.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
          const path = `${folder}/pj_${uid}_${Math.random().toString(36).slice(2, 6)}.${ext}`

          const { error: uploadErr } = await supabase.storage
            .from('pj-leboncoin')
            .upload(path, att.content, { contentType: att.contentType || 'image/jpeg', upsert: true })

          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('pj-leboncoin').getPublicUrl(path)
            uploadedUrls.push(urlData.publicUrl)
          }
        }

        // Found attachments, stop looking
        if (uploadedUrls.length > 0) break
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
        debug: { emailsScanned: uids.length, debugInfo },
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
