// Tests du brouillon de facture : rang et solde des acomptes, formule du
// solde (chantier / livraison), mention ACQUITTÉE, reprise d'un brouillon.
//   node --test tests/        (Node ≥ 22.18 : types TypeScript retirés à la volée)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  creerBrouillonFacture, refaireBrouillonFacture, pctFr, estChantier, reglementDeclare,
} from '../lib/factures-creer.ts'

/** Faux client Supabase : tables en mémoire, filtres eq / neq / in, rpc de création. */
function fauxSupabase(tables = {}) {
  const crees = []
  const sb = {
    crees,
    from(nom) {
      const filtres = []
      let mode = 'select'
      const lignes = () => (tables[nom] || []).filter((r) => filtres.every((f) => f(r)))
      const q = {
        select() { return q },
        delete() { mode = 'delete'; return q },
        order() { return q },
        limit() { return q },
        eq(c, v) { filtres.push((r) => r[c] === v); return q },
        neq(c, v) { filtres.push((r) => r[c] !== v); return q },
        in(c, vs) { filtres.push((r) => vs.includes(r[c])); return q },
        maybeSingle() { return Promise.resolve({ data: lignes()[0] || null, error: null }) },
        single() { return q.maybeSingle() },
        then(ok, ko) {
          const data = lignes()
          if (mode === 'delete') tables[nom] = (tables[nom] || []).filter((r) => !data.includes(r))
          return Promise.resolve({ data, error: null }).then(ok, ko)
        },
      }
      return q
    },
    rpc(nom, { payload }) {
      assert.equal(nom, 'facture_creer_brouillon')
      const id = `nouveau-${crees.length + 1}`
      const row = { id, statut: 'brouillon', numero: null, total_ttc: null, created_at: `2026-10-22T00:00:0${crees.length}Z`, ...payload }
      crees.push(row)
      ;(tables.factures ||= []).push(row)
      return Promise.resolve({ data: id, error: null })
    },
  }
  return sb
}

const CLIENT = { nom: 'Société KAB ISOBAT', adresse: '1 rue X', cp: '91000', ville: 'Evry', siren: '123456789' }
const COMMANDE = [{ designation: 'Menuiseries aluminium, fourniture et pose', quantite: 1, prix_unitaire_ht: 32981, tva: 0 }]
const acompte = (pct, date) => ({
  environnement: 'prod', type: 'acompte', reference_externe: 'COM00475', acompte_pct: pct,
  lignes: COMMANDE, client: CLIENT, autoliquidation: true, categorie_operation: 'mixte',
  date_vente: date, regle_le: date, regle_par: 'virement',
})

test('pourcentage à la française', () => {
  assert.equal(pctFr(30.32049), '30,32')
  assert.equal(pctFr(40), '40')
  assert.equal(pctFr(5.36673), '5,37')
  assert.equal(pctFr(47.953316156773084), '47,95')
})

test('chantier : catégorie, autoliquidation ou ligne de pose ; « hors pose » reste une fourniture', () => {
  assert.equal(estChantier({ categorie: 'mixte' }), true)
  assert.equal(estChantier({ categorie: 'biens', autoliquidation: true }), true)
  assert.equal(estChantier({ categorie: 'biens', lignes: [{ designation: 'Pose de 3 fenêtres' }] }), true)
  assert.equal(estChantier({ categorie: 'biens', lignes: [{ designation: 'Menuiseries, fourniture seule (hors pose)' }] }), false)
  assert.equal(estChantier({ categorie: 'biens', lignes: [{ designation: 'Volet roulant' }] }), false)
})

test('règlement déclaré : mode lisible, date future refusée', () => {
  assert.equal(reglementDeclare('2026-09-10', 'cheque', 470).reglement.mode, 'chèque')
  assert.match(reglementDeclare('2999-01-01', 'virement', 1).erreur, /futur/)
  assert.match(reglementDeclare('10/09/2026', 'virement', 1).erreur, /invalide/)
  assert.deepEqual(reglementDeclare('', 'virement', 1), {})
})

test('KAB COM00475 : trois acomptes, rang et reste dû cumulés, achèvement des travaux', async () => {
  const sb = fauxSupabase({ factures: [] })
  const attendus = [[5.36673, '2026-06-17', 31211, 1], [30.32049, '2026-08-15', 21211, 2], [15.46345, '2026-08-21', 16111, 3]]
  for (const [pct, date] of attendus) {
    const r = await creerBrouillonFacture(sb, acompte(pct, date))
    assert.equal(r.status, 200, JSON.stringify(r.corps))
  }
  sb.crees.forEach((f, i) => {
    const a = f.mentions.acompte
    assert.equal(a.rang, attendus[i][3])
    assert.equal(Math.round(a.reste_ttc), attendus[i][2])
    assert.equal(a.remise, 'chantier')
    assert.equal(a.precedents.length, i)
    assert.match(f.lignes[0].designation, new RegExp(`^Acompte n° ${i + 1} de \\d+,\\d+ %`))
    assert.equal(f.mentions.reglement.mode, 'virement')
    assert.match(f.conditions_reglement, /^Acompte réglé par virement le \d\d\/\d\d\/2026$/)
  })
  assert.deepEqual(sb.crees.map((f) => f.mentions.acompte.facture_ttc), [1770, 10000, 5100])
})

test('un acompte annulé par un avoir émis ne compte pas', async () => {
  const sb = fauxSupabase({
    factures: [
      { id: 'a1', type: 'acompte', devis_numero: 'COM00475', environnement: 'prod', statut: 'emise', numero: 'FA-2026-00010', date_vente: '2026-06-17', created_at: '2026-06-17', total_ttc: 1770 },
      { id: 'av', type: 'avoir', facture_liee: 'a1', statut: 'emise', environnement: 'prod' },
    ],
  })
  const r = await creerBrouillonFacture(sb, acompte(30.32049, '2026-08-15'))
  assert.equal(r.status, 200)
  assert.equal(sb.crees[0].mentions.acompte.rang, 1)
  assert.equal(Math.round(sb.crees[0].mentions.acompte.reste_ttc), 22981)
})

test('facture réglée (hors acompte) : mention de règlement et conditions « réglée »', async () => {
  const sb = fauxSupabase({ factures: [] })
  const r = await creerBrouillonFacture(sb, {
    environnement: 'prod', type: 'facture', reference_externe: 'DC-00638', client: { ...CLIENT, siren: undefined },
    lignes: [{ designation: 'Volet roulant', quantite: 1, prix_unitaire_ht: 391.67, tva: 20 }],
    regle_le: '2026-09-10', regle_par: 'cheque',
  })
  assert.equal(r.status, 200)
  const f = sb.crees[0]
  assert.equal(f.mentions.reglement.acquittee, true)
  assert.equal(f.mentions.reglement.montant_ttc, 470)
  assert.equal(f.conditions_reglement, 'Facture réglée par chèque le 10/09/2026')
})

test('refaire : l’ancien brouillon est exclu, les montants ne bougent pas, le rang suit', async () => {
  const vieux = (id, date, ttc, pct, cree) => ({
    id, type: 'acompte', statut: 'brouillon', environnement: 'prod', devis_numero: 'COM00475', numero: null,
    categorie_operation: 'mixte', client: CLIENT, motif_tva_zero: 'Autoliquidation…', date_vente: date, date_echeance: date,
    created_at: cree, total_ttc: null, conditions_reglement: 'Paiement à réception de facture',
    lignes: [{ designation: `Acompte ${pct} % sur Menuiseries, fourniture et pose`, details: '— détail', quantite: 1, prix_unitaire_ht: ttc, tva: 0 }],
    mentions: { acompte: { pct, remise: 'livraison', devis: null, commande_ht: 32981, commande_ttc: 32981, facture_ttc: ttc, reste_ttc: 32981 - ttc } },
  })
  const sb = fauxSupabase({
    factures: [vieux('v1', '2026-06-17', 1770, 5.36673, '2026-10-21T08:00:00Z'),
      vieux('v2', '2026-08-15', 10000, 30.32049, '2026-10-21T08:01:00Z'),
      vieux('v3', '2026-08-21', 5100, 15.46345, '2026-10-21T08:02:00Z')],
  })
  const restes = []
  for (const [id, date] of [['v1', '2026-06-17'], ['v2', '2026-08-15'], ['v3', '2026-08-21']]) {
    const r = await refaireBrouillonFacture(sb, { facture_id: id, regle_le: date, regle_par: 'virement' })
    assert.equal(r.status, 200, JSON.stringify(r.corps))
    restes.push(r.corps.reste_ttc)
    // le script supprime l'ancien APRÈS vérification du PDF
    await sb.from('factures').delete().eq('id', id)
  }
  assert.deepEqual(restes, [31211, 21211, 16111])
  const [n1, n2, n3] = sb.crees
  assert.equal(n2.lignes[0].prix_unitaire_ht, 10000)
  assert.equal(n2.lignes[0].details, '— détail')
  assert.equal(n2.lignes[0].designation, 'Acompte n° 2 de 30,32 % sur Menuiseries, fourniture et pose')
  assert.equal(n3.mentions.acompte.precedents.length, 2)
  assert.equal(n1.mentions.acompte.remise, 'chantier')
  assert.equal(n3.conditions_reglement, 'Acompte réglé par virement le 21/08/2026')
})

test('refaire refuse une facture émise', async () => {
  const sb = fauxSupabase({ factures: [{ id: 'e', statut: 'emise', numero: 'FA-2026-00001', type: 'facture' }] })
  const r = await refaireBrouillonFacture(sb, { facture_id: 'e' })
  assert.equal(r.status, 400)
})
