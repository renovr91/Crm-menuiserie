/**
 * Find the LBC relay email for a conversation participant.
 *
 * Searches Gmail IMAP for emails from @messagerie.leboncoin.fr
 * and matches by participant name and/or ad title.
 *
 * Also provides a function to save/retrieve relay emails from Supabase.
 */

import { ImapFlow } from 'imapflow'
import { createAdminClient } from './supabase'

/**
 * Search Gmail for the relay email matching a participant name + ad title.
 * Returns the xxx@messagerie.leboncoin.fr address or null.
 */
export async function findRelayEmailFromGmail(
  participantName: string,
  adTitle?: string
): Promise<string | null> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || 'renov.r91@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD || 'qrftxzawsvlcoanq',
    },
    logger: false,
  })

  try {
    await client.connect()

    // Try "All Mail" first (catches emails in Promotions/Updates tabs)
    let mailboxName = 'INBOX'
    try {
      const mailboxes = await client.list()
      const allMail = mailboxes.find((mb: { specialUse?: string }) => mb.specialUse === '\\All')
      if (allMail) mailboxName = allMail.path
    } catch {
      /* fallback to INBOX */
    }

    const lock = await client.getMailboxLock(mailboxName)
    try {
      // Search for recent LBC emails (last 30 days)
      const since = new Date()
      since.setDate(since.getDate() - 30)

      const searchResults = await client.search({ since })
      if (!searchResults || searchResults.length === 0) return null

      const uidStr = searchResults.join(',')

      // Fetch envelopes to find LBC relay emails
      const candidates: Array<{ address: string; subject: string; date: Date }> = []

      for await (const msg of client.fetch(uidStr, { envelope: true }, { uid: true })) {
        const fromAddr = msg.envelope?.from?.[0]?.address || ''
        if (!fromAddr.includes('@messagerie.leboncoin.fr')) continue

        const subject = msg.envelope?.subject || ''
        const fromName = msg.envelope?.from?.[0]?.name || ''
        const date = msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0)

        // Check if participant name matches (in subject or from name)
        const nameLower = participantName.toLowerCase()
        const subjectLower = subject.toLowerCase()
        const fromNameLower = fromName.toLowerCase()

        const nameMatches =
          subjectLower.includes(nameLower) ||
          fromNameLower.includes(nameLower) ||
          // Also match first name only
          nameLower.split(' ').some((part) => part.length > 2 && fromNameLower.includes(part))

        // Check if ad title matches
        const titleMatches = adTitle
          ? subjectLower.includes(adTitle.toLowerCase()) ||
            adTitle
              .toLowerCase()
              .split(' ')
              .filter((w) => w.length > 3)
              .some((word) => subjectLower.includes(word))
          : false

        if (nameMatches || titleMatches) {
          candidates.push({ address: fromAddr, subject, date })
        }
      }

      if (candidates.length === 0) return null

      // If we have both name and title, prefer candidates that match both
      if (participantName && adTitle) {
        const bothMatch = candidates.filter((c) => {
          const s = c.subject.toLowerCase()
          const nameLower = participantName.toLowerCase()
          const titleLower = adTitle.toLowerCase()
          return (
            (s.includes(nameLower) ||
              nameLower.split(' ').some((p) => p.length > 2 && s.includes(p))) &&
            (s.includes(titleLower) ||
              titleLower
                .split(' ')
                .filter((w) => w.length > 3)
                .some((w) => s.includes(w)))
          )
        })
        if (bothMatch.length > 0) {
          // Return the most recent match
          bothMatch.sort((a, b) => b.date.getTime() - a.date.getTime())
          return bothMatch[0].address
        }
      }

      // Return the most recent matching candidate
      candidates.sort((a, b) => b.date.getTime() - a.date.getTime())
      return candidates[0].address
    } finally {
      lock.release()
    }
  } catch (error) {
    console.error('[findRelayEmail] IMAP error:', error)
    return null
  } finally {
    await client.logout()
  }
}

/**
 * Get relay email from Supabase (cached value)
 */
export async function getRelayEmailFromDB(conversationId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('lbc_leads')
    .select('relay_email')
    .eq('conversation_id', conversationId)
    .single()
  return data?.relay_email || null
}

/**
 * Save relay email to Supabase for future use
 */
export async function saveRelayEmailToDB(
  conversationId: string,
  relayEmail: string
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('lbc_leads')
    .update({ relay_email: relayEmail })
    .eq('conversation_id', conversationId)
}

/**
 * Full flow: get from DB cache, or search Gmail, then cache result
 */
export async function findRelayEmail(
  conversationId: string,
  participantName: string,
  adTitle?: string
): Promise<string | null> {
  // 1. Check DB cache first
  const cached = await getRelayEmailFromDB(conversationId)
  if (cached) return cached

  // 2. Search Gmail
  const found = await findRelayEmailFromGmail(participantName, adTitle)
  if (found) {
    // 3. Cache in DB
    await saveRelayEmailToDB(conversationId, found)
    return found
  }

  return null
}
