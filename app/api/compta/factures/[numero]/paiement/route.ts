import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../../../_lib'

const MOYENS = ['cheque', 'especes', 'cb_monetico', 'virement']

// POST /api/compta/factures/FA-2026-00001/paiement
// { montant, moyen, date?, reference?, note? }
// Seule écriture autorisée depuis le CRM : la saisie d'un encaissement, via la
// RPC (les triggers gardent tout le reste). Le PDF ne pouvant être régénéré
// qu'en Python, on journalise pdf_a_regenerer → badge dans la liste, puis
// `python3 facturer.py pdf FA-…` côté Mac/Hermès.
export async function POST(req: NextRequest, ctx: { params: Promise<{ numero: string }> }) {
  try {
    const { numero } = await ctx.params
    const corps = await req.json()
    const montant = Number(corps.montant)
    const moyen = String(corps.moyen || '')
    if (!Number.isFinite(montant) || montant <= 0)
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    if (!MOYENS.includes(moyen))
      return NextResponse.json({ error: `Moyen invalide (${MOYENS.join(', ')})` }, { status: 400 })
    if ((moyen === 'cheque' || moyen === 'virement') && !corps.reference)
      return NextResponse.json({ error: 'Référence obligatoire pour un chèque ou un virement (traçabilité)' }, { status: 400 })

    const sb = admin()
    const { data: f, error: e1 } = await sb
      .from('factures').select('id').eq('numero', numero)
      .eq('environnement', envFacturation(req)).single()
    if (e1 || !f) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

    // Acteur : nom de l'utilisateur CRM connecté si dispo
    let acteur = 'crm'
    try {
      const me = await fetch(new URL('/api/me', req.url), { headers: { cookie: req.headers.get('cookie') || '' } })
      if (me.ok) { const d = await me.json(); if (d?.nom) acteur = `crm:${d.nom}` }
    } catch { /* acteur générique */ }

    const { data: statut, error } = await sb.rpc('facture_saisir_paiement', {
      p_facture_id: f.id,
      p_montant: montant,
      p_moyen: moyen,
      p_date: corps.date || new Date().toISOString().slice(0, 10),
      p_reference: corps.reference || null,
      p_note: corps.note || null,
      p_acteur: acteur,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // L'archive PDF date d'avant ce paiement : on la retire, quel que soit le
    // statut résultant (payée OU partiellement payée — dans les deux cas le
    // document archivé ment sur les règlements). Le prochain téléchargement
    // regénère et ré-archive, via le repli de la route PDF.
    await sb.from('factures').update({ pdf_path: null }).eq('id', f.id)

    await sb.from('facture_evenements').insert({
      facture_id: f.id, evenement: 'pdf_a_regenerer', acteur,
      details: { raison: 'paiement saisi depuis le CRM' },
    })
    return NextResponse.json({ numero, statut })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
