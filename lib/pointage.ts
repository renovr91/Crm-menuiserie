import type { SupabaseClient } from '@supabase/supabase-js'

// NOYAU DU POINTAGE BANCAIRE — partagé par l'écran (app/api/banque/pointage)
// et par la VEILLE qui alerte sur Telegram (action agent `virements_a_signaler`).
//
// POURQUOI PARTAGÉ : deux copies de cette heuristique dériveraient, et une
// dérive ici ne se voit pas — elle se traduit par un encaissement rapproché du
// mauvais client. Un seul moteur, deux façons de le consulter.

// Écart toléré entre le mouvement et le montant attendu : les arrondis de TVA
// et d'acompte se jouent au centime, pas à l'euro près.
const TOLERANCE_EUR = 1
// Un règlement arrive rarement plus de deux mois après l'émission ; au-delà, la
// coïncidence de montant ne veut plus rien dire.
const FENETRE_JOURS = 75

type Candidat = {
  type: 'facture' | 'devis'
  id: string
  reference: string
  client: string | null
  montant_attendu: number
  emis_le: string | null
  motif: string
}

// Le NOM est un meilleur signal que le montant, et c'est contre-intuitif.
// Mesuré le 27/08/2026 sur les mouvements réels : sur 19 crédits, le montant
// seul n'en rapprochait que 2, et les DEUX à tort — deux règlements de 1 000 €
// tombaient sur des devis d'autres clients par pure coïncidence. Les gros
// encaissements, eux, sont des soldes qui ne valent ni le total du devis ni un
// pourcentage rond : le montant ne les retrouve jamais.
// Les libellés, en revanche, nomment le payeur : « M ALI BENDAOUDI — Acompte »,
// « M RODOLPHE HATCHI — Acompte 50 volet roulant ».
const normaliser = (s: string) =>
  (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sans accents
    .toUpperCase()
    .replace(/\b(M|MR|MME|MLLE|MONSIEUR|MADAME|SARL|SAS|SASU|EURL|EI)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

/** Le numéro de devis écrit par le client dans sa référence de virement.
 *  C'est le signal le PLUS FORT : il ne doit rien au hasard, le client l'a
 *  recopié depuis le devis. Depuis le 27/08/2026 le numéro figure sous l'IBAN
 *  sur tous les documents, précisément pour rendre ce cas fréquent. */
const REF_DEVIS = /\bDC[-\s]*0*(\d{3,6})\b/i
const numeroDansLibelle = (libelle: string): string | null => {
  const m = REF_DEVIS.exec(libelle || '')
  return m ? `DC-${m[1].padStart(5, '0')}` : null
}

/** Le nom du client apparaît-il dans le libellé bancaire ? */
const nomDansLibelle = (client: string | null, libelle: string) => {
  const c = normaliser(client || '')
  if (c.length < 4) return false          // « SCI », « ALM » : trop court, trop de faux positifs
  const l = normaliser(libelle)
  // Un seul mot du nom suffit s'il fait au moins 4 lettres — les libellés
  // inversent souvent prénom et nom, ou n'en gardent qu'un.
  return c.split(' ').some((mot) => mot.length >= 4 && l.includes(mot))
}

export type LignePointage = Record<string, any> & {
  montant: number
  suggestions: (Candidat & { certitude: string })[]
}

/** Les mouvements bancaires et leurs correspondances probables. */
export async function calculerPointage(
  sb: SupabaseClient,
  inclureTraitees = false,
): Promise<{ lignes: LignePointage[]; candidats: Candidat[] }> {

  let req = sb
    .from('operations_bancaires')
    .select('*')
    .order('date_operation', { ascending: false })
    .limit(200)
  if (!inclureTraitees) {
    req = req.is('pointee_le', null).is('ignoree_le', null)
  }
  const { data: operations, error } = await req
  if (error) throw new Error(error.message)

  // Ce qui attend un règlement. Les deux sources coexistent : aujourd'hui les
  // devis, les factures dès qu'il y en aura — sans rien à refaire le jour venu.
  // ⚠️ `devis_claudus` EST la table des devis de l'entreprise (843 lignes au
  // 27/08/2026). `devis` et `factures_impayees` sont vides : elles attendent le
  // moteur de facturation. L'écran ne lisait que ces deux-là, donc il n'avait
  // AUCUN candidat et ne proposait jamais rien — il affichait des mouvements
  // bancaires face à une liste vide, sans que rien ne le signale.
  const [{ data: impayees }, { data: devis }, { data: claudus }] = await Promise.all([
    sb.from('factures_impayees').select('*').limit(300),
    sb
      .from('devis')
      .select('id, reference, montant_ttc, acompte_pct, signed_at, payment_status, clients(nom)')
      .neq('payment_status', 'paye')
      .not('signed_at', 'is', null)
      .limit(300),
    sb
      .from('devis_claudus')
      .select('id, numero, client_nom, montant_ttc, acompte_pct, created_at')
      .gte('created_at', new Date(Date.now() - 400 * 86400000).toISOString())
      .order('created_at', { ascending: false })
      .limit(400),
  ])

  const candidats: Candidat[] = []
  for (const f of impayees || []) {
    const restant = Number((f as Record<string, unknown>).restant ?? 0)
    if (!restant) continue
    candidats.push({
      type: 'facture',
      id: String((f as Record<string, unknown>).id ?? ''),
      reference: String((f as Record<string, unknown>).numero ?? ''),
      client: ((f as Record<string, unknown>).client_nom as string) ?? null,
      montant_attendu: restant,
      emis_le: ((f as Record<string, unknown>).emise_le as string) ?? null,
      motif: 'facture impayée',
    })
  }
  for (const d of devis || []) {
    const pct = Number(d.acompte_pct) || 0
    const total = Number(d.montant_ttc) || 0
    // Un devis avec acompte peut être réglé en deux fois : les deux montants
    // sont des correspondances plausibles, on ne choisit pas à sa place.
    const attendus = pct > 0
      ? [{ m: Math.round(total * pct) / 100, quoi: `acompte ${pct} %` }, { m: total, quoi: 'solde total' }]
      : [{ m: total, quoi: 'montant total' }]
    for (const a of attendus) {
      if (!a.m) continue
      candidats.push({
        type: 'devis',
        id: d.id,
        reference: d.reference,
        client: (Array.isArray(d.clients) ? d.clients[0]?.nom : (d.clients as { nom: string } | null)?.nom) ?? null,
        montant_attendu: a.m,
        emis_le: d.signed_at,
        motif: `devis signé — ${a.quoi}`,
      })
    }
  }

  // Les devis « claudus » n'ont ni statut de paiement ni date de signature : on
  // ne peut donc pas écarter ceux déjà réglés. C'est acceptable — un devis déjà
  // encaissé ne réapparaît pas, puisque l'opération qui l'a soldé est pointée et
  // sort de la liste. Mieux vaut une suggestion de trop qu'un encaissement
  // orphelin qu'on relance à tort.
  for (const d of claudus || []) {
    const pct = Number(d.acompte_pct) || 0
    const total = Number(d.montant_ttc) || 0
    const attendus = pct > 0
      ? [{ m: Math.round(total * pct) / 100, quoi: `acompte ${pct} %` }, { m: total, quoi: 'solde total' }]
      : [{ m: total, quoi: 'montant total' }]
    for (const a of attendus) {
      if (!a.m) continue
      candidats.push({
        type: 'devis',
        id: d.id,
        reference: d.numero,
        client: d.client_nom ?? null,
        montant_attendu: a.m,
        emis_le: d.created_at,
        motif: `devis — ${a.quoi}`,
      })
    }
  }

  const lignes = (operations || []).map((o) => {
    const montant = Number(o.montant)
    // On ne propose rien sur un débit ni sur une écriture encore provisoire.
    // Cas typique : la contrepartie d'une remise de chèque, passée au débit
    // sous réserve de bon encaissement. Elle s'annule d'elle-même — le crédit
    // correspondant, lui, est définitif et se rapproche normalement.
    const rapprochable = montant > 0 && o.definitive && !o.pointee_le && !o.ignoree_le

    // Deux signaux, et le NOM prime sur le montant. Un nom qui correspond avec
    // un montant different, c'est un solde ou un acompte partiel : c'est utile.
    // Un montant qui correspond avec un nom different, c'est une coincidence :
    // c'est dangereux, et on ne le propose que s'il est SEUL de son espece.
    const suggestions = rapprochable
      ? (() => {
          const dansLaFenetre = (c: Candidat) => {
            if (!c.emis_le) return true
            const jours =
              (new Date(o.date_operation).getTime() - new Date(c.emis_le).getTime()) / 86400000
            return jours >= -2 && jours <= FENETRE_JOURS
          }
          const libelle = String(o.libelle || '')
          const proches = candidats.filter(dansLaFenetre)

          // Référence explicite : elle écrase tout le reste. Si le client a
          // recopié « DC-00903 », il n'y a rien à deviner.
          const refEcrite = numeroDansLibelle(libelle)
          const parReference = refEcrite
            ? proches.filter((c) => c.reference === refEcrite)
            : []

          const parNom = proches.filter((c) => nomDansLibelle(c.client, libelle))
          const parMontant = proches.filter(
            (c) => Math.abs(c.montant_attendu - montant) <= TOLERANCE_EUR,
          )

          const notes = new Map<string, { c: Candidat; certitude: string }>()
          for (const c of parReference) {
            notes.set(`${c.type}-${c.id}-${c.montant_attendu}`, {
              c,
              certitude: 'référence du virement',
            })
          }
          for (const c of parNom) {
            if (notes.has(`${c.type}-${c.id}-${c.montant_attendu}`)) continue
            const exact = Math.abs(c.montant_attendu - montant) <= TOLERANCE_EUR
            notes.set(`${c.type}-${c.id}-${c.montant_attendu}`, {
              c,
              certitude: exact ? 'nom et montant' : 'nom du client',
            })
          }
          // Le montant seul n'entre QUE si aucun nom n'a repondu et qu'il est
          // sans ambiguite. Deux devis au meme montant, c'est un piege : on
          // prefere ne rien proposer plutot que de faire cliquer au hasard.
          if (!notes.size && !refEcrite && parMontant.length === 1) {
            const c = parMontant[0]
            notes.set(`${c.type}-${c.id}-${c.montant_attendu}`, { c, certitude: 'montant seul' })
          }

          const rang = (s: string) =>
            s === 'référence du virement' ? 0
              : s === 'nom et montant' ? 1
                : s === 'nom du client' ? 2 : 3
          return [...notes.values()]
            .sort((a, b) => {
              const d = rang(a.certitude) - rang(b.certitude)
              if (d) return d
              const da = a.c.emis_le
                ? Math.abs(new Date(o.date_operation).getTime() - new Date(a.c.emis_le).getTime())
                : Infinity
              const db = b.c.emis_le
                ? Math.abs(new Date(o.date_operation).getTime() - new Date(b.c.emis_le).getTime())
                : Infinity
              return da - db
            })
            .slice(0, 5)
            .map(({ c, certitude }) => ({ ...c, certitude }))
        })()
      : []
    return { ...o, montant, suggestions }
  })

  return { lignes, candidats }
}
