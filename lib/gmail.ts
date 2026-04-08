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
  emailContact: string | null
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
  emailContact: string | null
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
          // Extract the LBC relay email (unique per contact)
          const emailContact = parsed.from?.value?.[0]?.address || null

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
              emailContact,
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

  // Group by conversation — PRIMARY key: emailContact+titreAnnonce (same person same ad)
  // FALLBACK key: conversationKey (nomContact::titreAnnonce) for emails without emailContact
  const convMap = new Map<string, LeboncoinConversation>()
  // Index by emailContact+titreAnnonce to merge name variants (Xavier, Xavier ADAM, Xav = same person)
  const emailKeyIndex = new Map<string, string>() // emailKey -> convMap key

  for (const msg of allMessages) {
    // Build email-based key if available (best dedup: same relay email + same ad)
    const emailKey = msg.emailContact
      ? `${msg.emailContact}::${msg.titreAnnonce.toLowerCase()}`
      : null

    // Find existing group: first by emailKey, then by conversationKey
    let targetKey: string | undefined
    if (emailKey && emailKeyIndex.has(emailKey)) {
      targetKey = emailKeyIndex.get(emailKey)!
    } else if (convMap.has(msg.conversationKey)) {
      targetKey = msg.conversationKey
    }

    if (targetKey && convMap.has(targetKey)) {
      const existing = convMap.get(targetKey)!
      existing.messages.push({ date: msg.date, text: msg.messageClient, fullText: msg.fullBody })
      if (msg.date > existing.lastDate) {
        existing.lastDate = msg.date
        existing.lastMessage = msg.messageClient
        // Use the name from the most recent email
        existing.nomContact = msg.nomContact
        existing.conversationKey = msg.conversationKey
      }
      if (msg.hasAttachment) existing.hasAttachment = true
      if (msg.attachments.length > 0) existing.attachments.push(...msg.attachments)
      if (msg.emailContact && !existing.emailContact) existing.emailContact = msg.emailContact
      // Register this emailKey to point to the same group
      if (emailKey) emailKeyIndex.set(emailKey, targetKey)
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
        emailContact: msg.emailContact,
        attachments: [...msg.attachments],
      })
      // Register the emailKey index
      if (emailKey) emailKeyIndex.set(emailKey, msg.conversationKey)
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
  // Try multiple patterns from most specific to least
  const quotePatterns = [
    /[\u00AB\u201C«]\s*([\s\S]*?)\s*[\u00BB\u201D»]\s*[\n\r]/,  // « msg » + newline
    /[\u00AB\u201C«]\s*([\s\S]*?)\s*[\u00BB\u201D»]/,            // « msg » (no newline needed)
    /\u00AB\s*([\s\S]*?)\s*\u00BB/,                                // only « » chars
    /«\s*([\s\S]*?)\s*»/,                                         // raw « » chars
  ]
  for (const pattern of quotePatterns) {
    const match = text.match(pattern)
    if (match && match[1].trim()) {
      messageClient = match[1].trim()
      break
    }
  }

  // Last resort fallback: if subject matches LBC but no « » found,
  // try to extract the first non-empty line after the contact name
  if (!messageClient && nomContact) {
    const nameIdx = text.indexOf(nomContact)
    if (nameIdx >= 0) {
      const afterName = text.substring(nameIdx + nomContact.length)
      const lines = afterName.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      // Skip "Répondre" buttons and links, take first real content line
      const contentLine = lines.find(l => !l.startsWith('http') && !l.startsWith('(http') && !l.includes('Répondre') && l.length > 1 && l.length < 500)
      if (contentLine) {
        messageClient = contentLine
      }
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
