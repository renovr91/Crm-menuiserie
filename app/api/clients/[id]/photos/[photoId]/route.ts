import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// DELETE — supprimer une photo
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { photoId } = await params
  const supabase = createAdminClient()

  // Récupérer l'info photo pour extraire le chemin dans le bucket
  const { data: photo } = await supabase
    .from('client_photos')
    .select('file_url')
    .eq('id', photoId)
    .single()

  if (photo?.file_url) {
    // Extraire le chemin après /client-photos/
    const match = photo.file_url.match(/\/client-photos\/(.+)$/)
    if (match?.[1]) {
      await supabase.storage.from('client-photos').remove([match[1]])
    }
  }

  const { error } = await supabase.from('client_photos').delete().eq('id', photoId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
