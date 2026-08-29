import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../_lib'
import { convertirProforma } from '@/lib/proformas'

// GET  — les proformas en cours. Séparées des factures, et c'est volontaire :
//        une proforma n'a aucune valeur comptable, elle ne doit jamais se
//        retrouver dans les totaux de l'onglet ni dans le tri par numéro.
// POST — { numero, action: 'convertir' | 'supprimer' }.
//        Convertir = le client a payé, on crée le brouillon de facture.
//        Supprimer = il n'a pas payé, et il n'y a rien à annuler : c'est tout
//        l'intérêt de ce document.
export async function GET(req: NextRequest) {
  const sb = admin()
  const { data, error } = await sb
    .from('proformas')
    .select('id, numero, statut, client, devis_numero, total_ht, total_ttc, created_at, validite_jours, convertie_le, facture_id')
    .eq('environnement', envFacturation(req))
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // La facture née de chaque proforma convertie, pour que l'écran montre la
  // suite de l'histoire et pas seulement sa fin.
  const ids = (data || []).map((p) => p.facture_id).filter(Boolean) as string[]
  const factures = new Map<string, { numero: string | null; statut: string }>()
  if (ids.length) {
    const { data: fs } = await sb.from('factures').select('id, numero, statut').in('id', ids)
    for (const f of fs || []) factures.set(f.id, { numero: f.numero, statut: f.statut })
  }

  const rows = (data || []).map((p) => {
    const client = (p.client || {}) as { nom?: string }
    const age = Date.now() - new Date(p.created_at).getTime()
    return {
      id: p.id,
      numero: p.numero,
      statut: p.statut,
      client_nom: client.nom || null,
      devis_numero: p.devis_numero,
      total_ht: p.total_ht,
      total_ttc: p.total_ttc,
      cree_le: p.created_at,
      // Une proforma périmée ne doit pas être réglée sur un vieux prix.
      expiree: p.statut === 'active' && age > (p.validite_jours || 30) * 86400000,
      facture: p.facture_id ? factures.get(p.facture_id) || null : null,
    }
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const sb = admin()
  let body: { numero?: string; action?: string; regle_le?: string; regle_par?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }
  const numero = String(body.numero || '')
  if (!numero) return NextResponse.json({ error: 'numero requis' }, { status: 400 })

  if (body.action === 'supprimer') {
    const { data, error } = await sb
      .from('proformas').delete().eq('numero', numero).neq('statut', 'convertie').select('numero')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) {
      return NextResponse.json({ error: 'Introuvable, ou déjà convertie en facture' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, etat: 'supprimée' })
  }

  if (body.action === 'convertir') {
    const { status, corps } = await convertirProforma(sb, {
      numero, regle_le: body.regle_le, regle_par: body.regle_par, acteur: 'CRM',
    })
    return NextResponse.json(corps, { status })
  }

  return NextResponse.json({ error: "action inconnue ('convertir' ou 'supprimer')" }, { status: 400 })
}
