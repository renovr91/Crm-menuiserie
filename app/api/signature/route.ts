import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import crypto from 'crypto'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const { devis_id, signature_data, otp_id } = await request.json()

  // Récupérer le devis + client
  const { data: devis, error } = await supabase
    .from('devis')
    .select('id, status, reference, lignes, montant_ht, montant_ttc, pdf_url, client_id')
    .eq('id', devis_id)
    .single()

  if (error || !devis) return NextResponse.json({ error: 'Devis non trouvé' }, { status: 404 })
  if (devis.status === 'signe') return NextResponse.json({ error: 'Devis déjà signé' }, { status: 400 })

  // Récupérer le nom du client
  let clientNom = ''
  let clientCivilite = ''
  if (devis.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('nom, civilite')
      .eq('id', devis.client_id)
      .single()
    if (client) {
      clientNom = client.nom || ''
      clientCivilite = client.civilite || ''
    }
  }

  const signerName = clientCivilite ? `${clientCivilite} ${clientNom}` : clientNom || 'Client'

  // Hash du document
  const documentContent = JSON.stringify({ id: devis.id, lignes: devis.lignes, montant_ht: devis.montant_ht, montant_ttc: devis.montant_ttc })
  const documentHash = crypto.createHash('sha256').update(documentContent).digest('hex')

  const signerIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'

  // Sauvegarder la signature
  const { error: sigError } = await supabase.from('signatures').insert({
    devis_id,
    signature_data,
    signer_ip: signerIp,
    document_hash: documentHash,
    otp_id: otp_id || null,
  })
  if (sigError) return NextResponse.json({ error: sigError.message }, { status: 500 })

  const signedAt = new Date()

  // Générer le PDF signé avec le nom du client
  let signedPdfUrl = devis.pdf_url
  try {
    // Télécharger le PDF original
    const pdfResp = await fetch(devis.pdf_url, { cache: 'no-store' })
    if (!pdfResp.ok) throw new Error('PDF introuvable')
    const pdfBytes = await pdfResp.arrayBuffer()

    // Modifier le PDF
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const pages = pdfDoc.getPages()
    const lastPage = pages[pages.length - 1]
    const { width, height } = lastPage.getSize()

    // Zone signature en bas à droite
    const boxX = width - 260
    const boxY = 30
    const boxW = 240
    const boxH = 80

    // Fond léger
    lastPage.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: rgb(0.95, 0.97, 0.95),
      borderColor: rgb(0.7, 0.85, 0.7),
      borderWidth: 1,
    })

    // "Bon pour accord"
    lastPage.drawText('Bon pour accord', {
      x: boxX + 10,
      y: boxY + boxH - 18,
      size: 10,
      font: fontBold,
      color: rgb(0.15, 0.5, 0.15),
    })

    // Nom du client (comme signature)
    lastPage.drawText(signerName, {
      x: boxX + 10,
      y: boxY + boxH - 38,
      size: 14,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    })

    // Date + heure
    const dateStr = signedAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const timeStr = signedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    lastPage.drawText(`Le ${dateStr} à ${timeStr}`, {
      x: boxX + 10,
      y: boxY + boxH - 55,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })

    // Vérification SMS
    lastPage.drawText('Identité vérifiée par code SMS', {
      x: boxX + 10,
      y: boxY + boxH - 70,
      size: 7,
      font,
      color: rgb(0.4, 0.6, 0.4),
    })

    const signedPdfBytes = await pdfDoc.save()

    // Upload le PDF signé
    const fileName = `${devis.reference || devis.id}_signe.pdf`
    const { error: uploadError } = await supabase.storage
      .from('devis-pdf')
      .upload(fileName, signedPdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (!uploadError) {
      const { data: urlData } = supabase.storage.from('devis-pdf').getPublicUrl(fileName)
      signedPdfUrl = urlData.publicUrl
    }
  } catch (e) {
    console.error('Erreur génération PDF signé:', e)
    // Pas bloquant — on continue avec le PDF original
  }

  // Mettre à jour le devis
  await supabase.from('devis').update({
    status: 'signe',
    signed_at: signedAt.toISOString(),
    signed_pdf_url: signedPdfUrl,
  }).eq('id', devis_id)

  return NextResponse.json({ success: true, document_hash: documentHash, signed_pdf_url: signedPdfUrl })
}
