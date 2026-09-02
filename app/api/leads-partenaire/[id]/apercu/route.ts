import { NextResponse } from 'next/server'
import { preparerEnvoiLead } from '@/lib/leads-partenaire-envoi'

// GET /api/leads-partenaire/[id]/apercu
// Construit l'e-mail EXACT qui partirait (destinataire, sujet, HTML, pièces
// jointes listées) SANS RIEN ENVOYER — pour validation avant le premier envoi
// réel (demande gérant 02/09/2026 : "montre-moi le mail avant").
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const prep = await preparerEnvoiLead(id)
    return NextResponse.json({
      ok: true,
      destinataire: prep.destinataire,
      sujet: prep.sujet,
      html: prep.html,
      pieces_jointes: prep.attachments.map((a) => a.filename),
      avec_catalogue: prep.avecCatalogue,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, erreur: message }, { status: 400 })
  }
}
