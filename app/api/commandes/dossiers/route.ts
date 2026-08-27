import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { avancerCommande } from '@/lib/commandes-avancer'

// L'API de l'onglet Commandes (admin, protégée par le middleware).
// GET : tous les dossiers vivants + les livrés récents (30 j) pour mémoire.
// POST : avancer un dossier — même logique exactement que l'agent Telegram.
export async function GET() {
  const sb = createAdminClient()
  const [vivants, livres] = await Promise.all([
    sb.from('commandes')
      .select('id, devis_numero, designation, montant_ttc, stage, paye_le, paye_via, fournisseur, reference_commande, date_commande, date_reception_prevue, confirmation_pj, date_livraison_reelle, notes, updated_at, created_at, clients(nom, telephone)')
      .neq('stage', 'livree')
      .order('updated_at', { ascending: false })
      .limit(200),
    sb.from('commandes')
      .select('id, devis_numero, designation, montant_ttc, stage, fournisseur, date_livraison_reelle, clients(nom)')
      .eq('stage', 'livree')
      .gte('updated_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(50),
  ])
  if (vivants.error) return NextResponse.json({ error: vivants.error.message }, { status: 500 })
  return NextResponse.json({ dossiers: vivants.data || [], livres: livres.data || [] })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }
  const { status, corps } = await avancerCommande(createAdminClient(), body)
  return NextResponse.json(corps, { status })
}
