import { NextRequest, NextResponse } from 'next/server'
import { createTransport } from 'nodemailer'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const to = formData.get('to') as string
  const subject = formData.get('subject') as string
  const message = formData.get('message') as string
  const messageId = formData.get('messageId') as string
  const file = formData.get('file') as File | null

  if (!to || !message) {
    return NextResponse.json({ error: 'to et message requis' }, { status: 400 })
  }

  const supabase = createAdminClient()
  let pjUrl: string | null = null

  // 1. Upload PJ to Supabase Storage if provided
  let fileBuffer: Buffer | null = null
  let fileName: string | null = null
  let fileMime: string | null = null

  if (file && file.size > 0) {
    fileBuffer = Buffer.from(await file.arrayBuffer())
    fileName = file.name
    fileMime = file.type

    const { data: msg } = await supabase.from('messages').select('conversation_key').eq('id', messageId).single()
    const folder = (msg?.conversation_key || 'unknown').replace(/[^a-z0-9]/g, '_')
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${folder}/reply_${Date.now()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('pj-leboncoin')
      .upload(path, fileBuffer, { contentType: file.type, upsert: true })

    if (!uploadErr) {
      const { data: urlData } = supabase.storage.from('pj-leboncoin').getPublicUrl(path)
      pjUrl = urlData.publicUrl

      // Update message attachments
      const { data: msgData } = await supabase.from('messages').select('attachments').eq('id', messageId).single()
      const currentAttach = Array.isArray(msgData?.attachments) ? msgData.attachments : []
      currentAttach.push(pjUrl)
      await supabase.from('messages').update({ attachments: currentAttach, has_attachment: true }).eq('id', messageId)
    }
  }

  // 2. Send via SMTP (Gmail) with real attachment
  const transporter = createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })

  try {
    const mailOptions: {
      from: string; to: string; subject: string; text: string;
      attachments?: { filename: string; content: Buffer; contentType: string }[]
    } = {
      from: `SENROLL <${process.env.GMAIL_USER}>`,
      to,
      subject: subject || 'Re: LeBonCoin',
      text: message,
    }

    // Attach file if provided
    if (fileBuffer && fileName && fileMime) {
      mailOptions.attachments = [{
        filename: fileName,
        content: fileBuffer,
        contentType: fileMime,
      }]
    }

    await transporter.sendMail(mailOptions)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  // 3. Save reply in conversation history
  if (messageId) {
    const { data: msg } = await supabase.from('messages').select('reponse_generee').eq('id', messageId).single()
    const previousReplies = msg?.reponse_generee || ''
    const timestamp = new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    let newReply = `[${timestamp}] SENROLL: ${message}`
    if (pjUrl) newReply += `\n[PJ] ${pjUrl}`
    const allReplies = previousReplies ? previousReplies + '\n---\n' + newReply : newReply

    await supabase.from('messages')
      .update({ reponse_generee: allReplies, reponse_envoyee: true })
      .eq('id', messageId)
  }

  return NextResponse.json({ success: true, pjUrl })
}
