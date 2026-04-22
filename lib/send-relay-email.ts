import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'

/**
 * Find the original email from a relay address to reply to it.
 * Returns { messageId, subject } of the original email so we can thread properly.
 */
async function findOriginalEmail(relayEmail: string): Promise<{
  messageId: string
  subject: string
  references: string[]
} | null> {
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

    // Search All Mail for emails from this relay address
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
      // Search for emails from this specific relay address (last 60 days)
      const since = new Date()
      since.setDate(since.getDate() - 60)

      const searchResults = await client.search({
        since,
        from: relayEmail,
      })

      if (!searchResults || searchResults.length === 0) {
        console.log('[findOriginalEmail] No emails found from', relayEmail)
        return null
      }

      // Get the most recent one - fetch headers
      const lastUid = searchResults[searchResults.length - 1]

      for await (const msg of client.fetch(String(lastUid), {
        envelope: true,
        headers: ['message-id', 'references', 'in-reply-to'],
      }, { uid: true })) {
        const messageId = msg.envelope?.messageId || ''
        const subject = msg.envelope?.subject || ''

        // Parse references from headers
        const headersRaw = msg.headers?.toString() || ''
        const references: string[] = []
        const refMatch = headersRaw.match(/References:\s*(.+?)(?:\r?\n(?!\s)|$)/is)
        if (refMatch) {
          const refs = refMatch[1].match(/<[^>]+>/g)
          if (refs) references.push(...refs)
        }

        console.log('[findOriginalEmail] Found original:', { messageId, subject })
        return { messageId, subject, references }
      }

      return null
    } finally {
      lock.release()
    }
  } catch (error) {
    console.error('[findOriginalEmail] IMAP error:', error)
    return null
  } finally {
    await client.logout()
  }
}

export async function sendRelayEmail(params: {
  relayEmail: string
  subject: string
  text: string
  attachment?: { filename: string; content: Buffer; contentType: string }
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmailUser = process.env.GMAIL_USER || 'renov.r91@gmail.com'
    const gmailPass = process.env.GMAIL_APP_PASSWORD || 'qrft xzaw svlc oanq'

    // Step 1: Find the original email to reply to
    const original = await findOriginalEmail(params.relayEmail)

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })

    const mailOptions: nodemailer.SendMailOptions = {
      from: gmailUser,
      to: params.relayEmail,
      text: params.text,
    }

    if (original) {
      // Reply mode: thread the email properly
      mailOptions.subject = original.subject.startsWith('Re:')
        ? original.subject
        : `Re: ${original.subject}`
      mailOptions.inReplyTo = original.messageId
      mailOptions.references = [...original.references, original.messageId].join(' ')
      console.log('[sendRelayEmail] Replying to thread:', original.messageId)
    } else {
      // Fallback: new email (might not work but worth trying)
      mailOptions.subject = params.subject
      console.log('[sendRelayEmail] No original found, sending new email')
    }

    if (params.attachment) {
      mailOptions.attachments = [
        {
          filename: params.attachment.filename,
          content: params.attachment.content,
          contentType: params.attachment.contentType,
        },
      ]
    }

    const info = await transporter.sendMail(mailOptions)
    console.log('[sendRelayEmail] Sent:', info.messageId, original ? '(reply)' : '(new)')
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error('[sendRelayEmail] Error:', error.message)
    return { success: false, error: error.message }
  }
}
