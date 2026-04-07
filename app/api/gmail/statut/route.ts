import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { id, statut } = await request.json()
  if (!id || !statut) return NextResponse.json({ error: 'id et statut requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('messages')
    .update({ statut })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
