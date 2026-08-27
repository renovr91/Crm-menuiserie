import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
//  Avancement d'un DOSSIER CLIENT — logique partagée.
//  Deux appelants : la route agent (Hermes, depuis Telegram) et le back-office
//  (onglet Commandes). Une seule implémentation : les règles du registre ne
//  doivent pas dépendre de la porte d'entrée — même leçon que factures-creer.
// ============================================================================

type Reponse = { status: number; corps: Record<string, unknown> }
const reponse = (corps: Record<string, unknown>, status: number): Reponse => ({ status, corps })

export async function avancerCommande(
  supabase: SupabaseClient,
  p: Record<string, any>,
): Promise<Reponse> {
  const ref = String(p.devis_numero || '').trim()
  const etape = String(p.etape || '')
  if (!ref) return reponse({ error: 'devis_numero requis' }, 400)

  const { data: dossier } = await supabase
    .from('commandes').select('id, stage').eq('devis_numero', ref).maybeSingle()
  if (!dossier) {
    return reponse({ error: `Aucun dossier pour ${ref}. Il se crée à la signature — devis signé ?` }, 404)
  }

  const maj: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (etape === 'payee') {
    const via = String(p.moyen || '')
    if (!['cheque', 'especes', 'cb', 'virement'].includes(via)) {
      return reponse({ error: 'moyen requis : cheque | especes | cb | virement' }, 400)
    }
    maj.stage = 'a_commander'
    maj.paye_le = String(p.date || new Date().toISOString().slice(0, 10))
    maj.paye_via = via
  } else if (etape === 'commandee') {
    if (dossier.stage === 'signe') {
      // Commander une marchandise pas payée est PARFOIS voulu (client de
      // confiance) mais jamais par accident : le paiement se marque d'abord.
      return reponse({ error: `${ref} n'est pas marqué payé. Marque le règlement d'abord (etape=payee).` }, 409)
    }
    maj.stage = 'commandee'
    maj.status = 'commandee' // miroir colonne historique
    maj.date_commande = String(p.date || new Date().toISOString().slice(0, 10))
    if (p.fournisseur) maj.fournisseur = String(p.fournisseur).slice(0, 80)
    if (p.date_reception_prevue) maj.date_reception_prevue = String(p.date_reception_prevue)
    if (p.confirmation_pj) maj.confirmation_pj = String(p.confirmation_pj)
    if (p.reference_commande) maj.reference_commande = String(p.reference_commande).slice(0, 80)
  } else if (etape === 'livree') {
    maj.stage = 'livree'
    maj.status = 'livree' // valeur admise par le check historique
    maj.date_livraison_reelle = String(p.date || new Date().toISOString().slice(0, 10))
  } else if (etape === 'reception_prevue') {
    if (!p.date_reception_prevue) return reponse({ error: 'date_reception_prevue requise' }, 400)
    maj.date_reception_prevue = String(p.date_reception_prevue)
  } else if (etape === 'piece') {
    if (!p.confirmation_pj) return reponse({ error: 'confirmation_pj requise' }, 400)
    maj.confirmation_pj = String(p.confirmation_pj)
  } else {
    return reponse({ error: 'etape : payee | commandee | reception_prevue | piece | livree' }, 400)
  }
  const { error } = await supabase.from('commandes').update(maj).eq('id', dossier.id)
  if (error) return reponse({ error: error.message }, 500)
  return reponse({ ok: true, devis_numero: ref, ...maj }, 200)
}
