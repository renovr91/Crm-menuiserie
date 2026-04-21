import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const tacheId = formData.get('tache_id') as string | null

  if (!file || !tacheId) {
    return NextResponse.json({ error: 'file et tache_id requis' }, { status: 400 })
  }

  // Upload to Supabase Storage
  const ext = file.name.split('.').pop() || 'bin'
  const fileName = `${tacheId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error: uploadError } = await supabase.storage
    .from('taches-pj')
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('taches-pj').getPublicUrl(fileName)

  const pj = {
    name: file.name,
    url: urlData.publicUrl,
    size: file.size,
    type: file.type,
    uploaded_at: new Date().toISOString(),
  }

  // Append to tache pieces_jointes
  const { data: tache } = await supabase.from('taches').select('pieces_jointes').eq('id', tacheId).single()
  const existing = (tache?.pieces_jointes as unknown[]) || []
  existing.push(pj)

  const { error: updateError } = await supabase
    .from('taches')
    .update({ pieces_jointes: existing, updated_at: new Date().toISOString() })
    .eq('id', tacheId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json(pj, { status: 201 })
}
