/**
 * Find the LBC relay email for a conversation.
 *
 * Matching par TEXTE DU MESSAGE : on cherche dans Gmail un email
 * @messagerie.leboncoin.fr dont le body contient les premiers mots
 * du premier message de la conversation. C'est unique car chaque
 * client écrit un message différent.
 *
 * La recherche se fait côté serveur Gmail (IMAP SEARCH BODY) — pas
 * besoin de parser le body en local.
 */

import { ImapFlow } from 'imapflow'
import { createAdminClient } from './supabase'

/**
 * Search Gmail for the relay email by searching the first message text
 * in email bodies. IMAP SEARCH BODY does server-side matching.
 */
export async function findRelayEmailFromGmail(
  firstMessageText: string,
  contactName: string
): Promise<string | null> {
  if (!firstMessageText || firstMessageText.length < 10) {
    console.log('[findRelayEmail] firstMessageText trop court ou absent')
    return null
  }

  // Take the first 60 chars of the message as search query
  // Remove special chars that break IMAP search
  const searchText = firstMessageText
    .replace(/["\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 60)

  if (searchText.length < 10) {
    console.log('[findRelayEmail] searchText trop court après nettoyage')
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
      console.log(`[findRelayEmail] Recherche IMAP BODY: "${searchText.substring(0, 40)}..."`)

      // IMAP SEARCH: from @messagerie.leboncoin.fr AND body contains message text
      const searchResults = await client.search({
        from: '@messagerie.leboncoin.fr',
        body: searchText,
      })

      if (!searchResults || searchResults.length === 0) {
        console.log('[findRelayEmail] Aucun résultat IMAP')
        return null
      }

      console.log(`[findRelayEmail] ${searchResults.length} email(s) trouvé(s)`)

      // If only 1 result → perfect match
      if (searchResults.length === 1) {
        for await (const msg of client.fetch(String(searchResults[0]), { envelope: true }, { uid: true })) {
          const fromAddr = msg.envelope?.from?.[0]?.address || ''
          if (fromAddr.includes('@messagerie.leboncoin.fr')) {
            console.log(`[findRelayEmail] MATCH UNIQUE: ${fromAddr}`)
            return fromAddr
          }
        }
      }

      // Multiple results → filter by contact name in from
      const contactLower = contactName?.toLowerCase() || ''
      for (const uid of [...searchResults].reverse()) {
        try {
          for await (const msg of client.fetch(String(uid), { envelope: true }, { uid: true })) {
            const fromAddr = msg.envelope?.from?.[0]?.address || ''
            if (!fromAddr.includes('@messagerie.leboncoin.fr')) continue

            if (!contactLower) {
              // No contact name filter, return the most recent
              console.log(`[findRelayEmail] MATCH (plus récent): ${fromAddr}`)
              return fromAddr
            }

            const fromName = (msg.envelope?.from?.[0]?.name || '').toLowerCase()
            const cleanFromName = fromName.replace(/\s*via\s+lebonco.*$/i, '').trim()

            if (cleanFromName.includes(contactLower) || contactLower.includes(cleanFromName)) {
              console.log(`[findRelayEmail] MATCH (nom+texte): ${cleanFromName} → ${fromAddr}`)
              return fromAddr
            }
          }
        } catch {
          continue
        }
      }

      // Fallback: return the most recent match even without name match
      for await (const msg of client.fetch(String(searchResults[searchResults.length - 1]), { envelope: true }, { uid: true })) {
        const fromAddr = msg.envelope?.from?.[0]?.address || ''
        if (fromAddr.includes('@messagerie.leboncoin.fr')) {
          console.log(`[findRelayEmail] MATCH FALLBACK: ${fromAddr}`)
          return fromAddr
        }
      }

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
 * Full flow: DB cache → Gmail IMAP search by message text → cache result
 */
export async function findRelayEmail(
  conversationId: string,
  contactName: string,
  firstMessageText: string
): Promise<string | null> {
  // 1. Check DB cache
  const cached = await getRelayEmailFromDB(conversationId)
  if (cached) return cached

  // 2. Search Gmail by message text (IMAP BODY search)
  const found = await findRelayEmailFromGmail(firstMessageText, contactName)
  if (found) {
    // 3. Cache
    await saveRelayEmailToDB(conversationId, found)
    return found
  }

  return null
}
