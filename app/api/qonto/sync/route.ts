import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// ============================================================================
//  Synchronisation QONTO → `operations_bancaires`
//
//  POURQUOI CETTE RÉÉCRITURE (27/08/2026) : la version précédente cherchait à
//  rapprocher elle-même chaque virement d'un devis, et n'a jamais rien produit.
//  Deux raisons, toutes deux structurelles :
//
//   1. Elle lisait la table `devis`, VIDE — les devis de l'entreprise sont dans
//      `devis_claudus`. La fonction sortait donc sur « aucun devis en attente »
//      sans même appeler Qonto, tous les jours depuis sa mise en service.
//   2. Elle exigeait que le numéro de devis figure dans le libellé du virement.
//      Rien ne le demandait au client avant aujourd'hui : aucun rapprochement
//      n'était possible, même si la première condition avait été remplie.
//
//  La table `payments` est donc restée vide, et les encaissements Qonto n'ont
//  jamais été suivis nulle part.
//
//  CE QU'ELLE FAIT MAINTENANT : elle ENREGISTRE les mouvements, sans chercher à
//  les apparier. Le rapprochement est déjà résolu ailleurs — l'écran de pointage
//  propose sur le montant, l'humain tranche. C'est la même mécanique que le CIC,
//  et elle ne dépend pas du soin qu'un client met à remplir sa référence.
//
//  Conséquence : l'agent et l'écran de pointage voient les DEUX banques, sans
//  qu'aucun des deux n'ait à connaître l'existence de Qonto.
// ============================================================================

const QONTO_LOGIN = (process.env.QONTO_LOGIN || '').trim()
const QONTO_SECRET = (process.env.QONTO_SECRET_KEY || '').trim()
const QONTO_IBAN = 'FR7616958000011144672670309'
const QONTO_BASE = 'https://thirdparty.qonto.com/v2'

// Profondeur relue à chaque passage. Une opération peut changer d'état après
// coup ; on la revoit et l'upsert la met à jour sans créer de doublon.
const FENETRE_JOURS = 30

async function qontoRequest(path: string) {
  const resp = await fetch(`${QONTO_BASE}${path}`, {
    // Format documenté par Qonto : « sign-in:secret-key », SANS encodage Base64.
    // Ce n'est pas du Basic Auth malgré la ressemblance.
    headers: { Authorization: `${QONTO_LOGIN}:${QONTO_SECRET}` },
    cache: 'no-store',
  })
  if (!resp.ok) {
    throw new Error(`Qonto ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  }
  return resp.json()
}

export async function GET() {
  if (!QONTO_LOGIN || !QONTO_SECRET) {
    return NextResponse.json({ error: 'Identifiants Qonto manquants' }, { status: 500 })
  }

  const supabase = createAdminClient()
  const depuis = new Date(Date.now() - FENETRE_JOURS * 86400000)

  let transactions: Record<string, unknown>[] = []
  try {
    // Les DEUX sens : les crédits pour le pointage des règlements clients, les
    // débits pour le suivi des achats. La table porte un montant signé.
    const data = await qontoRequest(
      `/transactions?iban=${QONTO_IBAN}&status[]=completed&status[]=pending` +
        `&settled_at_from=${depuis.toISOString()}&sort_by=settled_at:desc&per_page=100`,
    )
    transactions = (data.transactions || []) as Record<string, unknown>[]
  } catch (e) {
    // Message générique au client, détail dans les journaux du serveur.
    console.error('[qonto sync]', e)
    return NextResponse.json({ error: 'Qonto injoignable ou identifiants refusés' }, { status: 502 })
  }

  const lignes = []
  for (const tx of transactions) {
    const ref = String(tx.transaction_id || tx.id || '').trim()
    // Qonto renvoie un montant TOUJOURS POSITIF et un `side` qui porte le sens.
    // Le recopier tel quel enregistrerait les dépenses comme des recettes.
    const brut = Number(tx.amount)
    if (!ref || !Number.isFinite(brut)) continue
    const montant = String(tx.side) === 'debit' ? -Math.abs(brut) : Math.abs(brut)

    const quand = String(tx.settled_at || tx.emitted_at || '')
    if (!quand) continue

    const libelle = [tx.label, tx.reference].filter(Boolean).join(' — ').slice(0, 300)

    lignes.push({
      source: 'qonto',
      ref_externe: ref,
      date_operation: quand.slice(0, 10),
      libelle: libelle || '(sans libellé)',
      montant,
      // `pending` chez Qonto = pas encore réglé : à ne jamais annoncer comme
      // encaissé, exactement comme un PDNG côté CIC.
      definitive: String(tx.status) === 'completed',
      statut_banque: String(tx.status || ''),
      vue_le: new Date().toISOString(),
    })
  }

  if (!lignes.length) {
    return NextResponse.json({ ok: true, source: 'qonto', recues: 0, nouvelles: 0 })
  }

  // Combien sont NOUVELLES ? Sans ce comptage, chaque passage prétendrait avoir
  // ajouté cent opérations alors qu'il revoit les mêmes.
  const refs = lignes.map((l) => l.ref_externe)
  const { data: connues } = await supabase
    .from('operations_bancaires')
    .select('ref_externe')
    .eq('source', 'qonto')
    .in('ref_externe', refs)
  const dejaLa = new Set((connues || []).map((r) => r.ref_externe))

  // Idempotent : contrainte d'unicité sur (source, ref_externe). Une opération
  // déjà connue est mise à jour — son statut peut passer de pending à completed
  // — mais JAMAIS son pointage, qui appartient à l'humain.
  const { error } = await supabase
    .from('operations_bancaires')
    .upsert(lignes, { onConflict: 'source,ref_externe' })
  if (error) {
    return NextResponse.json({ error: `Enregistrement refusé : ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    source: 'qonto',
    recues: lignes.length,
    nouvelles: lignes.filter((l) => !dejaLa.has(l.ref_externe)).length,
    ignorees: transactions.length - lignes.length,
  })
}
