/**
 * Find the LBC relay email for a conversation.
 *
 * Matching EXACT : cherche le conversation_id dans le body des emails
 * provenant de @messagerie.leboncoin.fr. Chaque notif LBC contient
 * un lien leboncoin.fr/messages/CONVERSATION_ID, donc 0 risque d'erreur.
 */

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createAdminClient } from './supabase'

/**
 * Search Gmail for the relay email matching a conversation_id.
 * Cherche dans le body de chaque email @messagerie.leboncoin.fr
 * un lien contenant le conversation_id exact.
 */
export async function findRelayEmailFromGmail(
  conversationId: string
): Promise<string | null> {
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

    // Try "All Mail" first
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
        console.log('[findRelayEmail] Aucun email @messagerie.leboncoin.fr trouvé')
        return null
      }

      console.log(`[findRelayEmail] ${searchResults.length} emails @messagerie trouvés, recherche conv ${conversationId}...`)

      // Parcourir du plus récent au plus ancien
      const uids = [...searchResults].reverse()

      for (const uid of uids) {
        try {
          for await (const msg of client.fetch(String(uid), {
            envelope: true,
            source: true,
          }, { uid: true })) {
            const fromAddr = msg.envelope?.from?.[0]?.address || ''
            if (!fromAddr.includes('@messagerie.leboncoin.fr')) continue

            // Parser le body pour chercher le conversation_id
            const parsed = await simpleParser(msg.source)
            const body = (parsed.text || '') + (parsed.html || '')

            if (body.includes(conversationId)) {
              console.log(`[findRelayEmail] MATCH EXACT: ${fromAddr} contient ${conversationId}`)
              return fromAddr
            }
          }
        } catch {
          // Skip les emails qu'on arrive pas à parser
          continue
        }
      }

      console.log(`[findRelayEmail] Aucun email ne contient ${conversationId}`)
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
 * Full flow: get from DB cache, or search Gmail by conversation_id, then cache
 */
export async function findRelayEmail(
  conversationId: string
): Promise<string | null> {
  // 1. Check DB cache first
  const cached = await getRelayEmailFromDB(conversationId)
  if (cached) return cached

  // 2. Search Gmail by conversation_id (matching exact)
  const found = await findRelayEmailFromGmail(conversationId)
  if (found) {
    // 3. Cache in DB
    await saveRelayEmailToDB(conversationId, found)
    return found
  }

  return null
}
