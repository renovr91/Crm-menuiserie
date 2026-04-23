/**
 * Find the LBC relay email for a conversation.
 *
 * Matching STRICT : on cherche dans Gmail un email @messagerie.leboncoin.fr
 * dont le subject contient le titre exact de l'annonce ET le from name
 * contient le nom/pseudo du contact. Les deux doivent matcher.
 *
 * Format email LBC :
 *   From: "franky57 via leboncoin" <xxx@messagerie.leboncoin.fr>
 *   Subject: Nouveau message pour "Porte de garage isolée" sur leboncoin
 */

import { ImapFlow } from 'imapflow'
import { createAdminClient } from './supabase'

/**
 * Search Gmail for the relay email matching ad title + contact name.
 * BOTH must match for a result (strict matching).
 */
export async function findRelayEmailFromGmail(
  contactName: string,
  adTitle: string
): Promise<string | null> {
  if (!contactName || !adTitle) {
    console.log('[findRelayEmail] contactName et adTitle requis pour matching strict')
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

      console.log(`[findRelayEmail] ${searchResults.length} emails, cherche: "${contactName}" + "${adTitle}"`)

      // Parcourir du plus récent au plus ancien
      const uids = [...searchResults].reverse()

      for (const uid of uids) {
        try {
          for await (const msg of client.fetch(String(uid), { envelope: true }, { uid: true })) {
            const fromAddr = msg.envelope?.from?.[0]?.address || ''
            if (!fromAddr.includes('@messagerie.leboncoin.fr')) continue

            const fromName = (msg.envelope?.from?.[0]?.name || '').toLowerCase()
            const subject = (msg.envelope?.subject || '').toLowerCase()

            // Extract ad title from subject: Nouveau message pour "TITRE" sur leboncoin
            const titleInSubject = subject.includes(adTitle.toLowerCase())

            // Check contact name in from name: "pseudo via leboncoin"
            // Remove "via leboncoin" / "via lebonco." suffix
            const cleanFromName = fromName.replace(/\s*via\s+lebonco.*$/i, '').trim()
            const nameMatch = cleanFromName === contactName.toLowerCase() ||
              cleanFromName.includes(contactName.toLowerCase()) ||
              contactName.toLowerCase().includes(cleanFromName)

            // STRICT: both must match
            if (titleInSubject && nameMatch) {
              console.log(`[findRelayEmail] MATCH STRICT: from="${cleanFromName}" subject contient "${adTitle}" → ${fromAddr}`)
              return fromAddr
            }
          }
        } catch {
          continue
        }
      }

      console.log(`[findRelayEmail] Aucun match strict pour "${contactName}" + "${adTitle}"`)
      return null
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
 * Full flow: DB cache → Gmail strict search → cache result
 */
export async function findRelayEmail(
  conversationId: string,
  contactName: string,
  adTitle: string
): Promise<string | null> {
  // 1. Check DB cache first
  const cached = await getRelayEmailFromDB(conversationId)
  if (cached) return cached

  // 2. Search Gmail with strict matching (name + title both required)
  const found = await findRelayEmailFromGmail(contactName, adTitle)
  if (found) {
    // 3. Cache in DB
    await saveRelayEmailToDB(conversationId, found)
    return found
  }

  return null
}
