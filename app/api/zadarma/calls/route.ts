import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET — liste des appels avec nom du client + URL audio signée
export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('calls')
    .select('*, clients(nom)')
    .order('started_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // URL signée (bucket privé) pour l'écoute
  const calls = await Promise.all(
    (data || []).map(async (c) => {
      let audio: string | null = null
      if (c.recording_url) {
        const { data: signed } = await supabase.storage
          .from('recordings')
          .createSignedUrl(c.recording_url, 3600)
        audio = signed?.signedUrl || null
      }
      return { ...c, audio }
    })
  )

  return NextResponse.json(calls)
}
