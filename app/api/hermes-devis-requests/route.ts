import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

/**
 * File d'attente « Devis à traiter par Hermes » (section de la messagerie LBC).
 *
 * L'utilisateur dépose ici ses demandes de devis (texte libre + lead lié en
 * option) ; l'agent Hermes les lit via /api/agent (action devis_requests),
 * les traite (génération + envoi après confirmation Telegram) et les marque
 * traitées. Route protégée par le middleware (session admin requise).
 */

// GET ?statut=en_attente|traite|annule|tous  (défaut : tout sauf annulé)
export async function GET(req: NextRequest) {
  try {
    const statut = req.nextUrl.searchParams.get('statut') || ''
    const supabase = createAdminClient()
    let q = supabase
      .from('hermes_devis_requests')
      .select('id, created_at, conversation_id, contact_name, ad_title, demande, statut, traite_note, traite_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (statut && statut !== 'tous') q = q.eq('statut', statut)
    else if (!statut) q = q.neq('statut', 'annule')
    const { data, error } = await q
    if (error) throw error
    return NextResponse.json({ demandes: data })
  } catch {
    return NextResponse.json({ error: 'Erreur de chargement' }, { status: 500 })
  }
}

// POST { demande, conversation_id?, contact_name?, ad_title? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const demande = String(body.demande || '').trim()
    if (!demande) {
      return NextResponse.json({ error: 'Demande vide' }, { status: 400 })
    }
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('hermes_devis_requests')
      .insert({
        demande: demande.slice(0, 2000),
        conversation_id: body.conversation_id ? String(body.conversation_id) : null,
        contact_name: body.contact_name ? String(body.contact_name).slice(0, 120) : null,
        ad_title: body.ad_title ? String(body.ad_title).slice(0, 200) : null,
      })
      .select('id, created_at, contact_name, ad_title, demande, statut')
      .single()
    if (error) throw error
    return NextResponse.json({ ok: true, demande: data })
  } catch {
    return NextResponse.json({ error: "Erreur d'enregistrement" }, { status: 500 })
  }
}

// DELETE ?id=  — retire une demande (annulée, pas supprimée : trace conservée)
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id') || ''
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('hermes_devis_requests')
      .update({ statut: 'annule' })
      .eq('id', id)
      .eq('statut', 'en_attente') // on n'annule pas une demande déjà traitée
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Erreur d'annulation" }, { status: 500 })
  }
}
