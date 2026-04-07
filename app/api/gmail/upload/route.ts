import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File
  const messageId = formData.get('messageId') as string

  if (!file || !messageId) {
    return NextResponse.json({ error: 'file et messageId requis' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Get message info for path
  const { data: msg } = await supabase.from('messages').select('conversation_key, attachments').eq('id', messageId).single()
  if (!msg) return NextResponse.json({ error: 'Message non trouve' }, { status: 404 })

  const folder = msg.conversation_key.replace(/[^a-z0-9]/g, '_')
  const ext = file.name.split('.').pop() || 'jpg'
  const filename = `pj_${Date.now()}.${ext}`
  const path = `${folder}/${filename}`

  // Upload to Supabase Storage
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await supabase.storage
    .from('pj-leboncoin')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  // Get public URL
  const { data: urlData } = supabase.storage.from('pj-leboncoin').getPublicUrl(path)
  const url = urlData.publicUrl

  // Update message attachments
  const currentAttach = Array.isArray(msg.attachments) ? msg.attachments : []
  currentAttach.push(url)

  await supabase.from('messages').update({
    attachments: currentAttach,
    has_attachment: true,
  }).eq('id', messageId)

  return NextResponse.json({ success: true, url })
}
