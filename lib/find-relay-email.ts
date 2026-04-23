/**
 * Find the LBC relay email for a conversation.
 *
 * Matching par NOM + DATE : on cherche dans Gmail un email @messagerie.leboncoin.fr
 * dont le from name contient le pseudo du contact ET dont la date est la plus proche
 * de la date de création de la conversation. Pas de doublon possible sauf si 2 personnes
 * avec le même pseudo écrivent dans la même minute.
 *
 * Format email LBC :
 *   From: "franky57 via leboncoin" <xxx@messagerie.leboncoin.fr>
 *   Subject: Nouveau message pour "Porte de garage isolée" sur leboncoin
 *   Date: Wed, 22 Apr 2026 23:24:00 +0200
 */

import { ImapFlow } from 'imapflow'
import { createAdminClient } from './supabase'

/**
 * Search Gmail for the relay email matching contact name + closest date.
 */
export async function findRelayEmailFromGmail(
  contactName: string,
  conversationDate: string
): Promise<string | null> {
  if (!contactName || !conversationDate) {
    console.log('[findRelayEmail] contactName et conversationDate requis')
    return null
  }

  const targetDate = new Date(conversationDate).getTime()
  if (isNaN(targetDate)) {
    console.log('[findRelayEmail] conversationDate invalide:', conversationDate)
    return null
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || 'renov.r91@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD || 'qrft xzaw svlc oanq',
    },
    logger: false,
  })

  try {
    await client.connect()

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
      // Search emails from @messagerie.leboncoin.fr (last 90 days)
      const since = new Date()
      since.setDate(since.getDate() - 90)

      const searchResults = await client.search({
        since,
        from: '@messagerie.leboncoin.fr',
      })

      if (!searchResults || searchResults.length === 0) {
        console.log('[findRelayEmail] Aucun email @messagerie.leboncoin.fr')
        return null
      }

      console.log(`[findRelayEmail] ${searchResults.length} emails, cherche: "${contactName}" proche de ${conversationDate}`)

      // Collect all candidates that match the name
      const candidates: Array<{ address: string; date: number; fromName: string; subject: string }> = []

      for (const uid of searchResults) {
        try {
          for await (const msg of client.fetch(String(uid), { envelope: true }, { uid: true })) {
            const fromAddr = msg.envelope?.from?.[0]?.address || ''
            if (!fromAddr.includes('@messagerie.leboncoin.fr')) continue

            const fromName = (msg.envelope?.from?.[0]?.name || '').toLowerCase()
            const subject = msg.envelope?.subject || ''
            const emailDate = msg.envelope?.date ? new Date(msg.envelope.date).getTime() : 0

            // Clean from name: "franky57 via leboncoin" → "franky57"
            const cleanFromName = fromName.replace(/\s*via\s+lebonco.*$/i, '').trim()

            // Check contact name match
            const contactLower = contactName.toLowerCase()
            const nameMatch = cleanFromName === contactLower ||
              cleanFromName.includes(contactLower) ||
              contactLower.includes(cleanFromName)

            if (nameMatch && emailDate > 0) {
              candidates.push({ address: fromAddr, date: emailDate, fromName: cleanFromName, subject })
            }
          }
        } catch {
          continue
        }
      }

      if (candidates.length === 0) {
        console.log(`[findRelayEmail] Aucun email de "${contactName}"`)
        return null
      }

      // Find the candidate with the closest date to conversationDate
      candidates.sort((a, b) => Math.abs(a.date - targetDate) - Math.abs(b.date - targetDate))
      const best = candidates[0]
      const diffMinutes = Math.abs(best.date - targetDate) / 60000

      console.log(`[findRelayEmail] MATCH: "${best.fromName}" — diff ${diffMinutes.toFixed(0)} min — ${best.address}`)
      console.log(`[findRelayEmail]   Email: ${new Date(best.date).toISOString()} | Conv: ${new Date(targetDate).toISOString()}`)

      // Accept if within 24h (the first notification email can arrive hours after the message)
      if (diffMinutes > 1440) {
        console.log(`[findRelayEmail] Trop loin (>24h), rejeté`)
        return null
      }

      return best.address
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
 * Full flow: DB cache → Gmail search (nom + date) → cache result
 */
export async function findRelayEmail(
  conversationId: string,
  contactName: string,
  conversationDate: string
): Promise<string | null> {
  // 1. Check DB cache first
  const cached = await getRelayEmailFromDB(conversationId)
  if (cached) return cached

  // 2. Search Gmail (nom + date la plus proche)
  const found = await findRelayEmailFromGmail(contactName, conversationDate)
  if (found) {
    // 3. Cache in DB
    await saveRelayEmailToDB(conversationId, found)
    return found
  }

  return null
}
