import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { creerBrouillonFacture } from '@/lib/factures-creer'

// Enveloppe HTTP de la création de brouillon — la logique vit dans
// lib/factures-creer.ts, partagée avec la route agent (voir ce fichier pour
// le pourquoi). ⚠️ Cette route N'ÉMET PAS : un brouillon n'a pas de numéro.
export async function POST(request: Request) {
  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }
  const { status, corps } = await creerBrouillonFacture(createAdminClient(), body)
  return NextResponse.json(corps, { status })
}
