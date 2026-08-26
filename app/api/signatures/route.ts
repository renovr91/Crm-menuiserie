import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { listSubmissions, extractNumero, statutDe, envoyeLe, type StatutSignature } from '@/lib/docuseal'

export const dynamic = 'force-dynamic'

/**
 * Panneau Signatures — LECTURE SEULE.
 * Source de vérité des envois en cours : l'API DocuSeal (la table `signatures`
 * ne contient que les documents déjà signés, archivés la nuit).
 * Aucune route d'écriture ici : pas d'envoi ni de suppression de demande.
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  // ?masques=1 pour réafficher les envois masqués (tests rangés par l'utilisateur)
  const voirMasques = request.nextUrl.searchParams.get('masques') === '1'
  // Période affichée : par défaut le mois en cours, filtrée sur la DATE D'ENVOI.
  const periode = request.nextUrl.searchParams.get('periode') || 'mois'
  const depuis = debutPeriode(periode)

  let submissions
  try {
    submissions = await listSubmissions()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'erreur inconnue'
    return NextResponse.json({ error: `DocuSeal injoignable : ${msg}` }, { status: 502 })
  }

  const numeros = Array.from(
    new Set(submissions.map((s) => extractNumero(s.name)).filter((n): n is string => !!n)),
  )

  // Enrichissements (une requête par table, pas de N+1)
  const [devisRes, sigsRes, reglRes, masquesRes] = await Promise.all([
    numeros.length
      ? supabase.from('devis_claudus')
          .select('numero, client_nom, client_email, client_telephone, montant_ttc, acompte_pct, created_by')
          .in('numero', numeros)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    numeros.length
      ? supabase.from('signatures')
          .select('numero, pdf_signe_path, certificat_path, signed_at')
          .in('numero', numeros)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    numeros.length
      ? supabase.from('factures')
          .select('id, numero, devis_numero, type, statut, environnement, total_ttc, emise_le, facture_paiements(montant, moyen, date_paiement, reference)')
          .in('devis_numero', numeros)
          .neq('statut', 'brouillon')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from('devis_signatures').select('submission_id, masque').eq('masque', true),
  ])

  const masques = new Set<number>(
    ((masquesRes.data || []) as { submission_id: number }[]).map((m) => Number(m.submission_id)),
  )

  type DevisRow = { numero: string; client_nom?: string; client_email?: string; client_telephone?: string; montant_ttc?: number; acompte_pct?: number; created_by?: string }
  type SigRow = { numero: string; pdf_signe_path?: string; certificat_path?: string }
  type PaiementRow = { montant: number; moyen: string; date_paiement: string; reference?: string | null }
  type FactureRow = {
    id: string; numero: string; devis_numero: string; type: string; statut: string
    total_ttc: number; environnement: string; emise_le?: string | null; facture_paiements?: PaiementRow[]
  }

  const devisMap = new Map<string, DevisRow>()
  ;((devisRes.data || []) as DevisRow[]).forEach((d) => devisMap.set(d.numero, d))
  const sigMap = new Map<string, SigRow>()
  ;((sigsRes.data || []) as SigRow[]).forEach((s) => sigMap.set(s.numero, s))
  const facturesMap = new Map<string, FactureRow[]>()
  ;((reglRes.data || []) as FactureRow[]).forEach((f) => {
    const arr = facturesMap.get(f.devis_numero) || []
    arr.push(f)
    facturesMap.set(f.devis_numero, arr)
  })

  // Liens signés vers les PDF archivés (1 h)
  async function lienSigne(path?: string | null): Promise<string | null> {
    if (!path) return null
    const { data } = await supabase.storage.from('devis-pdf').createSignedUrl(path, 3600)
    return data?.signedUrl || null
  }

  const maintenant = Date.now()
  const lignes = await Promise.all(
    submissions.map(async (s) => {
      const numero = extractNumero(s.name)
      const statut: StatutSignature = statutDe(s)
      const sub = (s.submitters || [])[0]
      const sent = envoyeLe(s)
      const devis = numero ? devisMap.get(numero) : undefined
      const sig = numero ? sigMap.get(numero) : undefined
      const factures = (numero ? facturesMap.get(numero) : undefined) || []
      const paiements = factures.flatMap((f) => f.facture_paiements || [])

      const joursDepuisEnvoi = sent
        ? Math.floor((maintenant - new Date(sent).getTime()) / 86_400_000)
        : null

      return {
        submission_id: s.id,
        numero,
        titre: s.name,
        // test/démo = pas de n° de devis rattaché
        hors_devis: !numero,
        client_nom: sub?.name || devis?.client_nom || null,
        client_email: sub?.email || devis?.client_email || null,
        client_telephone: sub?.phone || devis?.client_telephone || null,
        montant_ttc: devis?.montant_ttc ?? null,
        acompte_pct: devis?.acompte_pct ?? null,
        cree_par: devis?.created_by ?? null,
        statut,
        sent_at: sent,
        opened_at: sub?.opened_at || null,
        signed_at: sub?.completed_at || s.completed_at || null,
        declined_at: sub?.declined_at || null,
        expire_at: s.expire_at,
        jours_depuis_envoi: joursDepuisEnvoi,
        // 🔥 a ouvert le devis mais n'a pas signé → à appeler
        chaud: statut === 'ouvert',
        // envoyé depuis 3 j sans même être ouvert → relance utile
        relance_conseillee: statut === 'envoye' && (joursDepuisEnvoi ?? 0) >= 3,
        pdf_signe_url: await lienSigne(sig?.pdf_signe_path),
        certificat_url: await lienSigne(sig?.certificat_path),
        audit_url: s.audit_log_url,
        factures: factures.map((f) => ({
          numero: f.numero, type: f.type, statut: f.statut,
          environnement: f.environnement, total_ttc: f.total_ttc, emise_le: f.emise_le,
        })),
        paiements,
        // Acompte attendu d'après le devis (montant TTC × pourcentage d'acompte)
        acompte_attendu:
          devis?.montant_ttc != null && devis?.acompte_pct != null
            ? Math.round((Number(devis.montant_ttc) * Number(devis.acompte_pct)) / 100)
            : null,
        total_regle: paiements.reduce((t, r) => t + (Number(r.montant) || 0), 0),
        facture_emise: factures.length > 0,
        acompte_regle: paiements.length > 0,
      }
    }),
  )

  // Les envois masqués (tests rangés depuis l'écran) sortent des listes ET des
  // statistiques — sinon un test fausserait le montant en attente.
  const jusqua = finPeriode(periode)
  const dansLaPeriode = (l: { sent_at: string | null }) => {
    if (!depuis && !jusqua) return true
    if (!l.sent_at) return false
    const t = new Date(l.sent_at).getTime()
    if (depuis && t < depuis.getTime()) return false
    if (jusqua && t >= jusqua.getTime()) return false
    return true
  }
  const visibles = (voirMasques ? lignes : lignes.filter((l) => !masques.has(Number(l.submission_id))))
    .filter(dansLaPeriode)

  // Dédoublonnage : un même devis peut être envoyé plusieurs fois (correction,
  // relance, test). Sans ça, son montant serait compté autant de fois qu'il y a
  // eu d'envois — sur DC-00882 renvoyé 11×, le "en attente" était multiplié par 11.
  // On garde une ligne par devis : la signée en priorité, sinon la plus récente.
  type LigneT = (typeof lignes)[number] & { envois: number; masque?: boolean }
  const groupes = new Map<string, typeof lignes>()
  const isoles: LigneT[] = []
  visibles.forEach((l) => {
    if (!l.numero) { isoles.push({ ...l, envois: 1, masque: masques.has(Number(l.submission_id)) }); return }
    const arr = groupes.get(l.numero) || []
    arr.push(l)
    groupes.set(l.numero, arr)
  })
  const dedup: LigneT[] = []
  groupes.forEach((arr) => {
    const recent = [...arr].sort(
      (a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime(),
    )
    const choisi = arr.find((x) => x.statut === 'signe') || recent[0]
    dedup.push({ ...choisi, envois: arr.length, masque: masques.has(Number(choisi.submission_id)) })
  })
  const uniques: LigneT[] = [...dedup, ...isoles]
  uniques.sort((a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime())

  const parStatut = (st: StatutSignature) => uniques.filter((l) => l.statut === st)
  const somme = (arr: LigneT[]) => arr.reduce((t, l) => t + (Number(l.montant_ttc) || 0), 0)
  const signes = parStatut('signe')
  const enAttente = [...parStatut('envoye'), ...parStatut('ouvert')]

  // Délai moyen envoi → signature (en heures)
  const delais = signes
    .filter((l) => l.sent_at && l.signed_at)
    .map((l) => (new Date(l.signed_at!).getTime() - new Date(l.sent_at!).getTime()) / 3_600_000)
  const delaiMoyenH = delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : null

  const traites = signes.length + parStatut('refuse').length
  return NextResponse.json({
    stats: {
      total: uniques.length,
      masques: masques.size,
      periode,
      depuis: depuis ? depuis.toISOString() : null,
      envoye: parStatut('envoye').length,
      ouvert: parStatut('ouvert').length,
      signe: signes.length,
      refuse: parStatut('refuse').length,
      expire: parStatut('expire').length,
      chauds: lignes.filter((l) => l.chaud).length,
      montant_en_attente: Math.round(somme(enAttente)),
      montant_signe: Math.round(somme(signes)),
      // acomptes signés mais pas encore encaissés
      acomptes_a_encaisser: signes.filter((l) => !l.acompte_regle).length,
      taux_signature: traites ? Math.round((signes.length / traites) * 100) : null,
      delai_moyen_h: delaiMoyenH,
    },
    lignes: uniques,
  })
}

/** Début de la période demandée (null = pas de borne). */
function debutPeriode(p: string): Date | null {
  const n = new Date()
  switch (p) {
    case 'tout':
      return null
    case 'annee':
      return new Date(n.getFullYear(), 0, 1)
    case '12mois':
      return new Date(n.getFullYear() - 1, n.getMonth(), n.getDate())
    case '3mois':
      return new Date(n.getFullYear(), n.getMonth() - 2, 1)
    case 'mois_dernier':
      return new Date(n.getFullYear(), n.getMonth() - 1, 1)
    case 'mois':
    default:
      return new Date(n.getFullYear(), n.getMonth(), 1)
  }
}

/** Fin de période (seul "mois_dernier" est borné à droite). */
function finPeriode(p: string): Date | null {
  const n = new Date()
  if (p === 'mois_dernier') return new Date(n.getFullYear(), n.getMonth(), 1)
  return null
}
