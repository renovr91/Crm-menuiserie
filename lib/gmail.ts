import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

export interface AttachmentData {
  filename: string
  contentType: string
  content: Buffer
  size: number
}

export interface LeboncoinMessage {
  emailId: string
  date: Date
  titreAnnonce: string
  nomContact: string
  messageClient: string
  fullBody: string
  hasAttachment: boolean
  attachments: AttachmentData[]
  conversationKey: string
}

export interface LeboncoinConversation {
  conversationKey: string
  titreAnnonce: string
  nomContact: string
  messages: { date: Date; text: string; fullText: string }[]
  lastDate: Date
  lastMessage: string
  hasAttachment: boolean
  hasPhone: boolean
  phone: string | null
  phoneContext: string | null
  attachments: AttachmentData[]
}

async function getImapClient() {
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
  await client.connect()
  return client
}

export async function fetchLeboncoinEmails(): Promise<LeboncoinConversation[]> {
  const client = await getImapClient()
  const allMessages: LeboncoinMessage[] = []

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date()
      since.setDate(since.getDate() - 10)

      // Step 1: Get all recent messages (Gmail IMAP search returns threads, not individual messages)
      const searchResults = await client.search({ since })
      if (!searchResults || !Array.isArray(searchResults) || searchResults.length === 0) return []

      // Step 2: Fetch envelopes to find "Nouveau message pour" subjects
      const clientUids: number[] = []
      const uidStr = searchResults.join(',')

      for await (const msg of client.fetch(uidStr, { envelope: true }, { uid: true })) {
        const subject = msg.envelope?.subject || ''
        if (subject.includes('Nouveau message pour')) {
          clientUids.push(msg.uid)
        }
      }

      if (clientUids.length === 0) return []

      // Step 3: Batch fetch all client messages with source (much faster than individual downloads)
      const clientUidStr = clientUids.join(',')
      for await (const msg of client.fetch(clientUidStr, { envelope: true, source: true, bodyStructure: true }, { uid: true })) {
        try {
          const source = msg.source
          if (!source) continue

          const parsed = await simpleParser(source)
          const subject = parsed.subject || ''
          const textBody = parsed.text || ''
          const htmlBody = typeof parsed.html === 'string' ? parsed.html : ''

          let fromName = ''
          const fromHeader = parsed.from?.text || ''
          const fromMatch = fromHeader.match(/^"?(.+?)"?\s+via\s+leboncoin/i)
          if (fromMatch) {
            fromName = fromMatch[1].trim()
          }

          const extracted = extractLeboncoinContent(subject, textBody, htmlBody)
          if (extracted) {
            const nomContact = extracted.nomContact || fromName
            // Extract real attachments (images, not tracking pixels)
            const realAttachments: AttachmentData[] = (parsed.attachments || [])
              .filter(a => !a.contentType?.includes('text') && (a.size || 0) > 500)
              .map(a => ({
                filename: a.filename || `photo_${Date.now()}.jpg`,
                contentType: a.contentType || 'image/jpeg',
                content: a.content,
                size: a.size || 0,
              }))

            allMessages.push({
              emailId: String(msg.uid),
              date: parsed.date || new Date(),
              titreAnnonce: extracted.titreAnnonce,
              nomContact,
              messageClient: extracted.messageClient,
              fullBody: textBody || htmlBody.replace(/<[^>]+>/g, ' '),
              hasAttachment: realAttachments.length > 0,
              attachments: realAttachments,
              conversationKey: `${nomContact}::${extracted.titreAnnonce}`.toLowerCase().replace(/[''`]/g, '').replace(/\s+/g, ' ').trim(),
            })
          }
        } catch {
          // Skip unparseable emails
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  // Group by conversation (same contact + same annonce)
  const convMap = new Map<string, LeboncoinConversation>()
  for (const msg of allMessages) {
    const existing = convMap.get(msg.conversationKey)
    if (existing) {
      existing.messages.push({ date: msg.date, text: msg.messageClient, fullText: msg.fullBody })
      if (msg.date > existing.lastDate) {
        existing.lastDate = msg.date
        existing.lastMessage = msg.messageClient
      }
      if (msg.hasAttachment) existing.hasAttachment = true
      if (msg.attachments.length > 0) existing.attachments.push(...msg.attachments)
    } else {
      convMap.set(msg.conversationKey, {
        conversationKey: msg.conversationKey,
        titreAnnonce: msg.titreAnnonce,
        nomContact: msg.nomContact,
        messages: [{ date: msg.date, text: msg.messageClient, fullText: msg.fullBody }],
        lastDate: msg.date,
        lastMessage: msg.messageClient,
        hasAttachment: msg.hasAttachment,
        hasPhone: false,
        phone: null,
        phoneContext: null,
        attachments: [...msg.attachments],
      })
    }
  }

  // Extract phone numbers from FULL email bodies (not just the « » message)
  // This catches numbers in conversation history and reply context
  const fullBodiesByConv = new Map<string, string[]>()
  for (const msg of allMessages) {
    const existing = fullBodiesByConv.get(msg.conversationKey) || []
    existing.push(msg.fullBody)
    fullBodiesByConv.set(msg.conversationKey, existing)
  }

  for (const conv of convMap.values()) {
    // Search in full bodies AND message texts
    const allText = [
      ...conv.messages.map(m => m.text),
      ...(fullBodiesByConv.get(conv.conversationKey) || []),
    ].join(' ')
    // Match French mobile numbers: 06/07 followed by 8 digits (with optional spaces/dots/dashes)
    const phoneMatch = allText.match(/(?:0[67])[\s./-]*(?:\d[\s./-]*){8}/g)
    if (phoneMatch) {
      conv.hasPhone = true
      conv.phone = phoneMatch[0].replace(/[\s./-]/g, '')
      // Find the message text that contains the phone number
      const phoneRaw = phoneMatch[0]
      for (const m of conv.messages) {
        if (m.text.includes(phoneRaw) || m.fullText.includes(phoneRaw)) {
          // Extract the « » message containing the phone, or the surrounding lines
          const sourceText = m.text.includes(phoneRaw) ? m.text : m.fullText
          const lines = sourceText.split('\n')
          const phoneLine = lines.findIndex(l => l.includes(phoneRaw))
          if (phoneLine >= 0) {
            const start = Math.max(0, phoneLine - 2)
            const end = Math.min(lines.length, phoneLine + 3)
            conv.phoneContext = lines.slice(start, end).join('\n').trim()
          } else {
            conv.phoneContext = m.text || null
          }
          break
        }
      }
    }
  }

  // Sort: conversations with phone first, then by most recent
  const conversations = Array.from(convMap.values())
  conversations.sort((a, b) => {
    if (a.hasPhone && !b.hasPhone) return -1
    if (!a.hasPhone && b.hasPhone) return 1
    return b.lastDate.getTime() - a.lastDate.getTime()
  })
  return conversations
}

function extractLeboncoinContent(subject: string, body: string, htmlBody?: string): { titreAnnonce: string; nomContact: string; messageClient: string } | null {
  // Subject: Nouveau message pour "Titre Annonce" sur leboncoin
  let titreAnnonce = ''
  const subjectMatch = subject.match(/Nouveau message pour\s*["\u201C]([^"\u201D]+)["\u201D]/i)
  if (subjectMatch) {
    titreAnnonce = subjectMatch[1].trim()
  } else {
    return null // Not a client message
  }

  // Use body text, or strip HTML as fallback
  const text = body || (htmlBody ? htmlBody.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ') : '')

  // Extract contact name — pattern: just the name on a line before the message
  let nomContact = ''
  const nomMatch = text.match(/Nom\s*:\s*(.+)/i)
  if (nomMatch) {
    nomContact = nomMatch[1].trim()
  } else {
    // Name is typically on the line after "nouveau message."
    const nameMatch = text.match(/nouveau message\.\s*\n\s*(.+)/i)
    if (nameMatch) {
      nomContact = nameMatch[1].trim()
    }
  }

  // Extract the actual message — it's between « and » (or unicode equivalents)
  let messageClient = ''
  const msgMatch = text.match(/[\u00AB\u201C«"]\s*([\s\S]*?)\s*[\u00BB\u201D»"]\s*[\n\r]/)
  if (msgMatch) {
    messageClient = msgMatch[1].trim()
  }
  // Fallback: try without requiring newline after closing quote
  if (!messageClient) {
    const msgMatch2 = text.match(/[\u00AB\u201C«"]\s*([\s\S]*?)\s*[\u00BB\u201D»"]/)
    if (msgMatch2) {
      messageClient = msgMatch2[1].trim()
    }
  }

  if (!messageClient) return null

  return { titreAnnonce, nomContact, messageClient }
}

export async function testGmailConnection(): Promise<{ success: boolean; error?: string; count?: number }> {
  try {
    const client = await getImapClient()
    const lock = await client.getMailboxLock('INBOX')
    const results = await client.search({ subject: 'Nouveau message pour', from: 'leboncoin' })
    lock.release()
    await client.logout()
    return { success: true, count: Array.isArray(results) ? results.length : 0 }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
