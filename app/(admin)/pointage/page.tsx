'use client'

/**
 * Pointage bancaire — les mouvements du compte face à ce qui attend un règlement.
 *
 * Ce que cet écran remplace : l'aller-retour entre Filbanque et le CRM.
 * Ce qu'il ne fait PAS : décider. Les libellés du CIC ne portent aucune
 * référence de devis, donc un rapprochement automatique sur le seul montant
 * confondrait deux affaires au même prix. Il propose, vous tranchez.
 */

import { useCallback, useEffect, useState } from 'react'

interface Suggestion {
  type: 'facture' | 'devis'
  id: string
  reference: string
  client: string | null
  montant_attendu: number
  emis_le: string | null
  motif: string
  // Sur quoi repose la proposition. « montant seul » est le plus fragile : deux
  // chantiers au même prix se ressemblent, le nom départage, pas la somme.
  certitude?: 'référence du virement' | 'nom et montant' | 'nom du client' | 'montant seul'
}

interface Operation {
  id: number
  source: string
  date_operation: string
  libelle: string
  montant: number
  definitive: boolean
  pointee_le: string | null
  ignoree_le: string | null
  devis_numero: string | null
  facture_id: string | null
  suggestions: Suggestion[]
}

const eur = (v: number) =>
  Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

export default function PointagePage() {
  const [operations, setOperations] = useState<Operation[]>([])
  const [candidats, setCandidats] = useState(0)
  const [chargement, setChargement] = useState(true)
  const [tout, setTout] = useState(false)
  const [enCours, setEnCours] = useState<number | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      const r = await fetch(`/api/banque/pointage${tout ? '?tout=1' : ''}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Chargement impossible')
      setOperations(d.operations || [])
      setCandidats(d.candidats_disponibles || 0)
      setErreur(null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible')
    } finally {
      setChargement(false)
    }
  }, [tout])

  useEffect(() => { charger() }, [charger])

  const agir = async (corps: Record<string, unknown>) => {
    setEnCours(Number(corps.id))
    try {
      const r = await fetch('/api/banque/pointage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Action refusée')
      setErreur(null)
      await charger()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Action refusée')
    } finally {
      setEnCours(null)
    }
  }

  const aPointer = operations.filter((o) => !o.pointee_le && !o.ignoree_le)
  const entrees = aPointer.filter((o) => o.montant > 0)
  const sorties = aPointer.filter((o) => o.montant < 0)
  const totalEntrees = entrees.reduce((s, o) => s + o.montant, 0)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-semibold text-gray-900">Pointage bancaire</h1>
        <button
          onClick={() => setTout(!tout)}
          className="text-sm text-gray-500 hover:text-gray-900 underline"
        >
          {tout ? 'Masquer ce qui est traité' : 'Afficher tout l’historique'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {aPointer.length} opération{aPointer.length > 1 ? 's' : ''} à traiter ·{' '}
        {eur(totalEntrees)} d’encaissements non rapprochés
      </p>

      {erreur && (
        <div className="mb-5 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {erreur}
        </div>
      )}

      {candidats === 0 && !chargement && (
        <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Aucune facture impayée ni devis signé en attente</strong> — les
          encaissements ne peuvent donc être rapprochés de rien pour l’instant.
          Vous pouvez tout de même écarter les lignes qui n’ont pas à être suivies.
        </div>
      )}

      {chargement ? (
        <p className="text-gray-400 text-sm">Chargement…</p>
      ) : (
        <>
          <Section titre="Encaissements" operations={entrees} agir={agir} enCours={enCours} />
          <Section titre="Décaissements" operations={sorties} agir={agir} enCours={enCours} sansSuggestion />
          {tout && (
            <Section
              titre="Déjà traité"
              operations={operations.filter((o) => o.pointee_le || o.ignoree_le)}
              agir={agir}
              enCours={enCours}
              sansSuggestion
            />
          )}
        </>
      )}
    </div>
  )
}

function Section({
  titre, operations, agir, enCours, sansSuggestion,
}: {
  titre: string
  operations: Operation[]
  agir: (c: Record<string, unknown>) => void
  enCours: number | null
  sansSuggestion?: boolean
}) {
  if (!operations.length) return null
  return (
    <section className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        {titre} <span className="text-gray-400 font-normal">· {operations.length}</span>
      </h2>
      <div className="space-y-2">
        {operations.map((o) => (
          <Ligne
            key={o.id}
            o={o}
            agir={agir}
            occupe={enCours === o.id}
            sansSuggestion={sansSuggestion}
          />
        ))}
      </div>
    </section>
  )
}

function Ligne({
  o, agir, occupe, sansSuggestion,
}: {
  o: Operation
  agir: (c: Record<string, unknown>) => void
  occupe: boolean
  sansSuggestion?: boolean
}) {
  const traitee = Boolean(o.pointee_le || o.ignoree_le)
  return (
    <div className={`rounded border px-4 py-3 ${traitee ? 'border-gray-100 bg-gray-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 tabular-nums">{dateFr(o.date_operation)}</span>
            <span className="text-xs uppercase tracking-wide text-gray-400">{o.source}</span>
            {!o.definitive && (
              <span
                className="text-[11px] rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
                title="Contrepartie technique d’une remise de chèque, sous réserve de bon encaissement. Elle s’annule d’elle-même : rien à faire."
              >
                sous réserve d’encaissement
              </span>
            )}
            {o.pointee_le && (
              <span className="text-[11px] rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                pointée {o.devis_numero ? `· ${o.devis_numero}` : ''}
              </span>
            )}
            {o.ignoree_le && (
              <span className="text-[11px] rounded bg-gray-200 px-1.5 py-0.5 text-gray-600">écartée</span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-800 truncate" title={o.libelle}>{o.libelle}</p>
        </div>
        <div className={`shrink-0 text-right tabular-nums font-semibold ${o.montant > 0 ? 'text-emerald-700' : 'text-gray-600'}`}>
          {eur(o.montant)}
        </div>
      </div>

      {!traitee && !sansSuggestion && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {o.suggestions.length ? (
            <div className="space-y-1.5">
              {o.suggestions.map((s, i) => (
                <div key={`${s.type}-${s.id}-${i}`} className="flex items-center justify-between gap-3">
                  <div className="text-sm text-gray-700 min-w-0">
                    <span className="font-medium">{s.reference}</span>
                    {s.client && <span className="text-gray-500"> · {s.client}</span>}
                    <span className="text-gray-400 text-xs"> — {s.motif}, {eur(s.montant_attendu)}</span>
                    {s.certitude && (
                      <span
                        className={`ml-2 text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ${
                          s.certitude === 'référence du virement'
                            ? 'bg-emerald-600 text-white'
                            : s.certitude === 'nom et montant'
                              ? 'bg-emerald-100 text-emerald-800'
                              : s.certitude === 'nom du client'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-gray-100 text-gray-600'
                        }`}
                        title={
                          s.certitude === 'référence du virement'
                            ? 'Le client a écrit le numéro de devis dans sa référence. Rien à deviner.'
                            : s.certitude === 'nom et montant'
                              ? 'Le nom du client et le montant concordent.'
                              : s.certitude === 'nom du client'
                                ? 'Le nom concorde mais pas le montant : acompte ou solde partiel.'
                                : 'Seul le montant concorde. Vérifiez le client avant de rapprocher.'
                        }
                      >
                        {s.certitude}
                      </span>
                    )}
                  </div>
                  <button
                    disabled={occupe}
                    onClick={() => agir({ id: o.id, type: s.type, cible: s.id, reference: s.reference, date: o.date_operation })}
                    className="shrink-0 rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-40"
                  >
                    Rapprocher
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <RechercheManuelle op={o} agir={agir} occupe={occupe} />
        </div>
      )}

      {!traitee && (
        <div className="mt-2 flex justify-end">
          <button
            disabled={occupe}
            onClick={() => agir({ id: o.id, action: 'ignorer' })}
            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40"
          >
            Écarter (frais, mouvement interne…)
          </button>
        </div>
      )}
      {traitee && (
        <div className="mt-2 flex justify-end">
          <button
            disabled={occupe}
            onClick={() => agir({ id: o.id, action: 'annuler' })}
            className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40"
          >
            Remettre à pointer
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Recherche manuelle — le filet quand rien n'est proposé.
 *
 * Deux cas réels, tous deux fréquents :
 *  - le client a oublié la référence, et son nom n'apparaît pas non plus ;
 *  - le devis vient de ProDevis et n'est pas en base.
 *
 * Sans ce bloc, la seule issue était « écarter » — ce qui ferait disparaître un
 * vrai encaissement client de la comptabilité. On préfère un rattachement noté
 * à la main qu'un mouvement effacé.
 */
function RechercheManuelle({
  op, agir, occupe,
}: {
  op: Operation
  agir: (c: Record<string, unknown>) => void
  occupe: boolean
}) {
  const [ouvert, setOuvert] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Suggestion[]>([])
  const [cherche, setCherche] = useState(false)

  const chercher = async (valeur: string) => {
    setQ(valeur)
    if (valeur.trim().length < 2) { setRes([]); return }
    setCherche(true)
    try {
      const r = await fetch(`/api/banque/pointage?q=${encodeURIComponent(valeur.trim())}`)
      const d = await r.json()
      setRes(d.resultats || [])
    } catch { setRes([]) } finally { setCherche(false) }
  }

  if (!ouvert) {
    return (
      <button
        onClick={() => setOuvert(true)}
        className="mt-2 text-xs text-gray-500 hover:text-gray-900 underline"
      >
        {op.suggestions.length ? 'Chercher un autre devis' : 'Chercher le devis à rapprocher'}
      </button>
    )
  }

  return (
    <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
      <input
        autoFocus
        value={q}
        onChange={(e) => chercher(e.target.value)}
        placeholder="Nom du client, ou numéro de devis…"
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
      />

      {cherche && <p className="mt-2 text-xs text-gray-400">Recherche…</p>}

      {res.length > 0 && (
        <div className="mt-2 space-y-1">
          {res.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-gray-700">
                <span className="font-medium">{s.reference}</span>
                {s.client && <span className="text-gray-500"> · {s.client}</span>}
                <span className="text-xs text-gray-400"> — {eur(s.montant_attendu)}</span>
              </span>
              <button
                disabled={occupe}
                onClick={() =>
                  agir({ id: op.id, type: 'devis', cible: s.id, reference: s.reference, date: op.date_operation })
                }
                className="shrink-0 rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-40"
              >
                Rapprocher
              </button>
            </div>
          ))}
        </div>
      )}

      {q.trim().length >= 2 && !cherche && res.length === 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            Aucun devis trouvé. S’il vient de ProDevis, notez sa référence :
          </p>
          <button
            disabled={occupe}
            onClick={() => agir({ id: op.id, type: 'libre', reference: q.trim() })}
            className="mt-1.5 rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-gray-100 disabled:opacity-40"
          >
            Rattacher à « {q.trim()} »
          </button>
        </div>
      )}
    </div>
  )
}
