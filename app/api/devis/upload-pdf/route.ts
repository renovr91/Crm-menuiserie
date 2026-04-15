import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const formData = await request.formData()
  const file = formData.get('file') as File
  const devisId = formData.get('devis_id') as string

  if (!file || !devisId) {
    return NextResponse.json({ error: 'Fichier et devis_id requis' }, { status: 400 })
  }

  // Vérifier que le devis existe
  const { data: devis, error } = await supabase
    .from('devis')
    .select('id, reference')
    .eq('id', devisId)
    .single()

  if (error || !devis) {
    return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })
  }

  // Upload vers Supabase Storage
  const fileName = `${devis.reference || devis.id}.pdf`
  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { error: uploadError } = await supabase.storage
    .from('devis-pdf')
    .upload(fileName, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: `Erreur upload: ${uploadError.message}` }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from('devis-pdf').getPublicUrl(fileName)
  const pdfUrl = urlData.publicUrl

  // Mettre à jour le devis avec l'URL du PDF
  await supabase
    .from('devis')
    .update({ pdf_url: pdfUrl })
    .eq('id', devisId)

  return NextResponse.json({ success: true, pdf_url: pdfUrl })
}
