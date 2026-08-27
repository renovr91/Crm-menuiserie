'use client'

/**
 * COMMANDES — le registre des dossiers clients, en quatre colonnes.
 *
 * C'est la vue back-office du flux qui vit d'abord sur Telegram : la signature
 * ouvre le dossier, le paiement le fait avancer, le brief du matin rappelle ce
 * qui traîne. Ici on VOIT tout d'un coup d'œil et on peut faire les mêmes
 * gestes qu'en parlant à l'agent — même logique serveur, même registre.
 *
 * La colonne « À commander » est le cœur : de l'argent encaissé pour une
 * marchandise que personne n'a commandée. C'est elle qu'on regarde en premier.
 */

import { useCallback, useEffect, useState } from 'react'

type Dossier = {
  id: string
  devis_numero: string | null
  designation: string | null
  montant_ttc: number | null
  stage: 'signe' | 'a_commander' | 'commandee' | 'livree'
  paye_le: string | null
  paye_via: string | null
  fournisseur: string | null
  reference_commande: string | null
  date_commande: string | null
  date_reception_prevue: string | null
  confirmation_pj: string | null
  date_livraison_reelle: string | null
  updated_at: string
  created_at: string
  clients: { nom: string; telephone?: string | null } | null
}

const eur = (v: number | null) =>
  v == null ? '' : Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : ''
const jours = (d: string | null) => {
  if (!d) return null
  const n = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  return n <= 0 ? "aujourd'hui" : `${n} j`
}

const COLONNES = [
  { stage: 'signe', titre: 'Signé — attente règlement', teinte: 'border-yellow-300' },
  { stage: 'a_commander', titre: 'Payé — À COMMANDER', teinte: 'border-red-400' },
  { stage: 'commandee', titre: 'Commandé', teinte: 'border-blue-300' },
  { stage: 'livree', titre: 'Livré (30 j)', teinte: 'border-emerald-300' },
] as const

export default function PageCommandes() {
  const [dossiers, setDossiers] = useState<Dossier[]>([])
  const [livres, setLivres] = useState<Dossier[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/commandes/dossiers')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Chargement impossible')
      setDossiers(d.dossiers || [])
      setLivres(d.livres || [])
      setErreur(null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible')
    } finally {
      setChargement(false)
    }
  }, [])
  useEffect(() => { charger() }, [charger])

  const avancer = async (d: Dossier, etape: string, extra: Record<string, unknown> = {}) => {
    setOccupe(d.id)
    try {
      const r = await fetch('/api/commandes/dossiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devis_numero: d.devis_numero, etape, ...extra }),
      })
      const rep = await r.json()
      if (!r.ok) { setErreur(rep.error); return }
      setErreur(null)
      await charger()
    } finally {
      setOccupe(null)
    }
  }

  const marquerPaye = (d: Dossier) => {
    const moyen = window.prompt('Réglé comment ? (virement / cheque / especes / cb)\n\nNB : un virement se rapproche normalement depuis l’écran Pointage — saisis-le ici seulement s’il est déjà certain.', 'cheque')
    if (!moyen) return
    avancer(d, 'payee', { moyen: moyen.trim().toLowerCase() })
  }
  const marquerCommande = (d: Dossier) => {
    const fournisseur = window.prompt('Commandé chez quel fournisseur ?', d.fournisseur || '')
    if (!fournisseur) return
    const reception = window.prompt('Date de réception prévue ? (AAAA-MM-JJ, vide si inconnue — le guetteur la lira dans la confirmation)', '')
    avancer(d, 'commandee', {
      fournisseur: fournisseur.trim(),
      ...(reception?.trim() ? { date_reception_prevue: reception.trim() } : {}),
    })
  }
  const marquerLivre = (d: Dossier) => {
    if (!window.confirm(`Marquer le dossier ${d.devis_numero} comme livré ?`)) return
    avancer(d, 'livree')
  }

  const auj = new Date().toISOString().slice(0, 10)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Commandes</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        Le registre des dossiers clients — signé → payé → commandé → livré. Les mêmes gestes marchent en parlant à Hermes.
      </p>
      {erreur && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{erreur}</div>
      )}
      {chargement ? (
        <p style={{ color: 'var(--text-muted)' }}>Chargement…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {COLONNES.map((col) => {
            const liste = col.stage === 'livree' ? livres : dossiers.filter((d) => d.stage === col.stage)
            return (
              <div key={col.stage} className={`rounded-lg border-t-4 ${col.teinte} border bg-white/50 p-3`}
                   style={{ borderLeftColor: 'var(--border-default)', borderRightColor: 'var(--border-default)', borderBottomColor: 'var(--border-default)', background: 'var(--surface-2)' }}>
                <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
                  {col.titre} <span className="font-normal" style={{ color: 'var(--text-muted)' }}>· {liste.length}</span>
                </h2>
                <div className="space-y-2">
                  {liste.length === 0 && (
                    <p className="text-xs py-3 text-center" style={{ color: 'var(--text-muted)' }}>—</p>
                  )}
                  {liste.map((d) => (
                    <div key={d.id} className="rounded border p-3 text-sm"
                         style={{ borderColor: 'var(--border-default)', background: 'var(--surface-1)', color: 'var(--text-primary)' }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate">{d.clients?.nom || d.designation || '?'}</span>
                        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{eur(d.montant_ttc)}</span>
                      </div>
                      <div className="mt-0.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {d.devis_numero} {d.designation && d.clients?.nom ? `· ${d.designation}` : ''}
                      </div>

                      {d.stage === 'signe' && (
                        <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          signé {jours(d.created_at) === "aujourd'hui" ? "aujourd'hui" : `il y a ${jours(d.created_at)}`}
                        </div>
                      )}
                      {d.stage === 'a_commander' && (
                        <div className="mt-1 text-xs font-medium text-red-700">
                          payé {d.paye_le ? `le ${dateFr(d.paye_le)}` : ''} ({d.paye_via}) — marchandise non commandée
                        </div>
                      )}
                      {d.stage === 'commandee' && (
                        <div className="mt-1 text-xs space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                          <div>chez <strong>{d.fournisseur || '?'}</strong> le {dateFr(d.date_commande)}</div>
                          {d.date_reception_prevue ? (
                            <div className={d.date_reception_prevue < auj ? 'text-red-700 font-medium' : ''}>
                              réception prévue {dateFr(d.date_reception_prevue)}
                              {d.date_reception_prevue < auj ? ' — DÉPASSÉE' : ''}
                            </div>
                          ) : (
                            <div style={{ color: 'var(--text-muted)' }}>date de réception inconnue</div>
                          )}
                          {!d.confirmation_pj && (
                            <div className="text-amber-700">confirmation absente — le guetteur surveille les mails</div>
                          )}
                        </div>
                      )}
                      {d.stage === 'livree' && (
                        <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          livré le {dateFr(d.date_livraison_reelle)}
                        </div>
                      )}

                      {d.stage !== 'livree' && (
                        <div className="mt-2 flex gap-2">
                          {d.stage === 'signe' && (
                            <button onClick={() => marquerPaye(d)} disabled={occupe === d.id}
                                    className="rounded bg-gray-900 px-2.5 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-40">
                              Réglé…
                            </button>
                          )}
                          {d.stage === 'a_commander' && (
                            <button onClick={() => marquerCommande(d)} disabled={occupe === d.id}
                                    className="rounded bg-red-700 px-2.5 py-1 text-xs text-white hover:bg-red-800 disabled:opacity-40">
                              Commandé chez…
                            </button>
                          )}
                          {d.stage === 'commandee' && (
                            <button onClick={() => marquerLivre(d)} disabled={occupe === d.id}
                                    className="rounded bg-emerald-700 px-2.5 py-1 text-xs text-white hover:bg-emerald-800 disabled:opacity-40">
                              Livré
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-6 text-xs" style={{ color: 'var(--text-muted)' }}>
        L’ancien suivi logistique reste accessible sur <a href="/livraisons" className="underline">/livraisons</a>.
      </p>
    </div>
  )
}
