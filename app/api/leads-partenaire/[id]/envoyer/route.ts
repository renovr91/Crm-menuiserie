import { NextResponse } from 'next/server'
import { envoyerDevisLead } from '@/lib/leads-partenaire-envoi'

// POST /api/leads-partenaire/[id]/envoyer
// Envoi RÉEL du devis au client. Protégé par le middleware admin (session) :
// pas de jeton public ici, seulement un clic humain depuis /leads-partenaire.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const resultat = await envoyerDevisLead(id)
  if (!resultat.ok) return NextResponse.json(resultat, { status: 400 })
  return NextResponse.json(resultat)
}
