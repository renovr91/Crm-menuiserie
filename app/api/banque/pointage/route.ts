import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Écran de pointage bancaire : les mouvements d'un côté, ce qui attend un
// règlement de l'autre, et les correspondances PROBABLES entre les deux.
//
// POURQUOI ASSISTÉ ET NON AUTOMATIQUE : les libellés du CIC ne portent aucune
// référence — « VIR INST RENOV-R LIBELLÉ NON RENSEIGNÉ » revient sans cesse.
// Un rapprochement sur le seul montant confondrait deux devis identiques (deux
// portes semblables, deux acomptes de 40 %), et on découvrirait l'erreur en
// relançant un client qui a déjà payé. La machine propose, l'humain tranche.

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
const REF_DEVIS = /\bDC[-\s]?0*(\d{3,6})\b/i
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

export async function GET(request: Request) {
  const sb = createAdminClient()
  const url = new URL(request.url)

  // RECHERCHE MANUELLE — le filet de sécurité quand rien n'est proposé.
  // Le client oublie souvent la référence, et certains devis viennent d'un autre
  // outil (ProDevis) et n'existent pas en base. Sans ce mode, l'écran ne laissait
  // que « écarter » : on aurait fait disparaître de vrais encaissements clients.
  const q = (url.searchParams.get('q') || '').trim()
  if (q) {
    const { data } = await sb
      .from('devis_claudus')
      .select('id, numero, client_nom, montant_ttc, acompte_pct, created_at')
      .or(`numero.ilike.%${q}%,client_nom.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20)
    return NextResponse.json({
      resultats: (data || []).map((d) => ({
        type: 'devis' as const,
        id: d.id,
        reference: d.numero,
        client: d.client_nom,
        montant_attendu: Number(d.montant_ttc) || 0,
        emis_le: d.created_at,
        motif: 'recherche manuelle',
      })),
    })
  }
  const inclureTraitees = url.searchParams.get('tout') === '1'

  let req = sb
    .from('operations_bancaires')
    .select('*')
    .order('date_operation', { ascending: false })
    .limit(200)
  if (!inclureTraitees) {
    req = req.is('pointee_le', null).is('ignoree_le', null)
  }
  const { data: operations, error } = await req
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  return NextResponse.json({
    operations: lignes,
    total_a_pointer: lignes.filter((l) => !l.pointee_le && !l.ignoree_le).length,
    // Le nombre de candidats dit si l'absence de suggestion vient d'un manque
    // de correspondance… ou d'une base vide. Ce n'est pas la même conclusion.
    candidats_disponibles: candidats.length,
  })
}

// Pointer une opération, ou l'écarter. Deux gestes, une seule route : dans les
// deux cas l'opération sort de la liste, et c'est ce qui compte pour l'écran.
export async function POST(request: Request) {
  const sb = createAdminClient()
  let corps: Record<string, unknown>
  try {
    corps = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
  }

  const id = Number(corps.id)
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const { data: op } = await sb
    .from('operations_bancaires')
    .select('id, montant, definitive, pointee_le, ignoree_le')
    .eq('id', id)
    .maybeSingle()
  if (!op) return NextResponse.json({ error: 'Opération inconnue' }, { status: 404 })

  // « Annuler » : on rend la ligne à la liste. Une erreur de pointage doit se
  // défaire, sinon on n'ose plus cliquer.
  if (corps.action === 'annuler') {
    const { error } = await sb
      .from('operations_bancaires')
      .update({ pointee_le: null, pointee_par: null, facture_id: null, devis_numero: null, ignoree_le: null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'rendue à pointer' })
  }

  if (corps.action === 'ignorer') {
    const { error } = await sb
      .from('operations_bancaires')
      .update({ ignoree_le: new Date().toISOString(), note: (corps.note as string) || null })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'écartée' })
  }

  if (op.pointee_le) {
    return NextResponse.json({ error: 'Opération déjà pointée' }, { status: 409 })
  }
  if (!op.definitive) {
    return NextResponse.json(
      { error: 'Écriture encore provisoire chez la banque : attendre qu’elle soit définitive.' },
      { status: 400 },
    )
  }

  const type = String(corps.type || '')

  // RÉFÉRENCE LIBRE : un devis produit par ProDevis n'est pas en base. On note
  // alors le numéro tel quel. L'opération sort de la liste et le lien reste
  // tracé — au lieu d'être « écartée », ce qui l'aurait fait disparaître de la
  // comptabilité alors que c'est un vrai encaissement client.
  if (type === 'libre') {
    const ref = String(corps.reference || '').trim()
    if (!ref) return NextResponse.json({ error: 'référence requise' }, { status: 400 })
    const { error } = await sb
      .from('operations_bancaires')
      .update({
        pointee_le: new Date().toISOString(),
        pointee_par: 'crm:manuel',
        devis_numero: ref.slice(0, 60),
        note: (corps.note as string) || 'rattachement manuel',
      })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, etat: 'pointée', type: 'libre', reference: ref })
  }

  const cible = String(corps.cible || '')
  if (!cible) return NextResponse.json({ error: 'cible requise' }, { status: 400 })

  // Sur une facture, on enregistre un VRAI paiement via la RPC existante :
  // c'est elle qui tient le statut et le restant dû, pas cet écran.
  if (type === 'facture') {
    const { error: eRpc } = await sb.rpc('facture_saisir_paiement', {
      p_facture_id: cible,
      p_montant: Number(op.montant),
      p_moyen: 'virement',
      p_date: String(corps.date || new Date().toISOString().slice(0, 10)),
      p_reference: (corps.reference as string) || null,
      p_note: 'pointage bancaire',
      p_acteur: 'crm:pointage',
    })
    if (eRpc) return NextResponse.json({ error: eRpc.message }, { status: 400 })
  }

  const { error } = await sb
    .from('operations_bancaires')
    .update({
      pointee_le: new Date().toISOString(),
      pointee_par: 'crm',
      facture_id: type === 'facture' ? cible : null,
      devis_numero: type === 'devis' ? String(corps.reference || cible) : null,
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, etat: 'pointée', type })
}
