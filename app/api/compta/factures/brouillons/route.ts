import { NextRequest, NextResponse } from 'next/server'
import { admin, envFacturation } from '../../_lib'

// GET  — les brouillons en attente d'émission. Séparés de la liste des émises :
//        un brouillon n'a ni numéro ni règlement, les mélanger casserait les
//        totaux de l'onglet et le tri par numéro.
// POST — { id, action: 'emettre' | 'supprimer' }.
//        L'ÉMISSION vit ici, dans le back-office, et nulle part ailleurs :
//        c'est le geste qui consomme un numéro et verrouille la chaîne. L'agent
//        prépare les brouillons, l'humain appuie. Un brouillon, lui, se
//        supprime sans trace — c'est toute sa raison d'être.
export async function GET(req: NextRequest) {
  const sb = admin()
  const { data, error } = await sb
    .from('factures')
    .select('id, type, statut, client, devis_numero, lignes, date_vente, date_echeance, conditions_reglement, created_by, created_at')
    .eq('environnement', envFacturation(req))
    .eq('statut', 'brouillon')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data || []).map((f) => {
    const lignes = (f.lignes || []) as { quantite?: number; prix_unitaire_ht?: number; tva?: number }[]
    const ht = lignes.reduce((s, l) => s + (Number(l.quantite) || 1) * (Number(l.prix_unitaire_ht) || 0), 0)
    const ttc = lignes.reduce(
      (s, l) => s + (Number(l.quantite) || 1) * (Number(l.prix_unitaire_ht) || 0) * (1 + (Number(l.tva) || 0) / 100),
      0,
    )
    const client = (f.client || {}) as { civilite?: string; nom?: string }
    return {
      id: f.id,
      type: f.type,
      client_nom: `${client.civilite || ''} ${client.nom || ''}`.trim(),
      devis_numero: f.devis_numero,
      nb_lignes: lignes.length,
      total_ht: Math.round(ht * 100) / 100,
      total_ttc: Math.round(ttc * 100) / 100,
      cree_par: f.created_by,
      cree_le: f.created_at,
    }
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const sb = admin()
  let body: { id?: string; action?: string; acteur?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  if (body.action === 'supprimer') {
    // Garde-fou dans le WHERE : même avec un id d'émise, rien ne part.
    const { error } = await sb.from('factures').delete().eq('id', id).eq('statut', 'brouillon')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'supprimé' })
  }

  if (body.action === 'emettre') {
    const { data: numero, error } = await sb.rpc('facture_emettre', {
      p_id: id,
      p_acteur: String(body.acteur || 'CRM'),
    })
    if (error) {
      // Le moteur valide tout à l'émission (client, TVA, échéance…) et son
      // message dit précisément ce qui cloche : on le transmet tel quel.
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true, numero })
  }

  return NextResponse.json({ error: "action inconnue ('emettre' ou 'supprimer')" }, { status: 400 })
}
