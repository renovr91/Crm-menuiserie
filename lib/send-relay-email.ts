import nodemailer from 'nodemailer'

export async function sendRelayEmail(params: {
  relayEmail: string
  subject: string
  text: string
  attachment?: { filename: string; content: Buffer; contentType: string }
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER || 'renov.r91@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD || 'qrftxzawsvlcoanq',
      },
    })

    const mailOptions: nodemailer.SendMailOptions = {
      from: process.env.GMAIL_USER || 'renov.r91@gmail.com',
      to: params.relayEmail,
      subject: params.subject,
      text: params.text,
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
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error('[sendRelayEmail] Error:', error.message)
    return { success: false, error: error.message }
  }
}
