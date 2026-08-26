'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

interface Reglement {
  numero: string
  type: string
  mode: string | null
  montant: number
  statut: string
  recu_le?: string | null
  reference?: string | null
}

interface Ligne {
  submission_id: number
  numero: string | null
  titre: string | null
  hors_devis: boolean
  client_nom: string | null
  client_email: string | null
  client_telephone: string | null
  montant_ttc: number | null
  acompte_pct: number | null
  cree_par: string | null
  statut: 'envoye' | 'ouvert' | 'signe' | 'refuse' | 'expire'
  sent_at: string | null
  opened_at: string | null
  signed_at: string | null
  jours_depuis_envoi: number | null
  chaud: boolean
  relance_conseillee: boolean
  pdf_signe_url: string | null
  certificat_url: string | null
  audit_url: string | null
  reglements: Reglement[]
  acompte_regle: boolean
  envois: number
  masque?: boolean
}

interface Stats {
  total: number; envoye: number; ouvert: number; signe: number
  refuse: number; expire: number; chauds: number
  montant_en_attente: number; montant_signe: number
  acomptes_a_encaisser: number
  taux_signature: number | null; delai_moyen_h: number | null
  masques?: number
  periode?: string
}

const STATUTS = {
  envoye: { label: 'En attente', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', emoji: '📤' },
  ouvert: { label: 'Vu, pas signé', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', emoji: '👀' },
  signe: { label: 'Signé', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', emoji: '✅' },
  refuse: { label: 'Refusé', color: 'bg-red-100 text-red-700', dot: 'bg-red-500', emoji: '❌' },
  expire: { label: 'Expiré', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', emoji: '⌛' },
} as const

const euro = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function delai(h: number | null) {
  if (h == null) return '—'
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} j`
}

export default function SignaturesPage() {
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [filtre, setFiltre] = useState<'tous' | 'attente' | 'chaud' | 'signe' | 'clos'>('tous')
  const [voirMasques, setVoirMasques] = useState(false)
  const [periode, setPeriode] = useState<'mois' | 'mois_dernier' | '3mois' | 'annee' | 'tout'>('mois')

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const r = await fetch(`/api/signatures?periode=${periode}${voirMasques ? '&masques=1' : ''}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur de chargement')
      setLignes(j.lignes || [])
      setStats(j.stats || null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setChargement(false)
    }
  }, [voirMasques, periode])

  useEffect(() => { charger() }, [charger])

  // Masquage LOCAL : range l'envoi hors de l'écran (tests, doublons).
  // Le document reste intact chez DocuSeal — rien n'est supprimé chez eux.
  const basculerMasque = useCallback(async (l: Ligne) => {
    const masquer = !l.masque
    if (masquer && !confirm(`Retirer « ${l.numero || l.titre} » du tableau ?\n\nLe document reste intact chez DocuSeal, tu pourras le réafficher.`)) return
    await fetch('/api/signatures/masquer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: l.submission_id, numero: l.numero, masque: masquer }),
    })
    charger()
  }, [charger])

  const visibles = useMemo(() => lignes.filter((l) => {
    if (filtre === 'attente') return l.statut === 'envoye'
    if (filtre === 'chaud') return l.chaud
    if (filtre === 'signe') return l.statut === 'signe'
    if (filtre === 'clos') return l.statut === 'refuse' || l.statut === 'expire'
    return true
  }), [lignes, filtre])

  const onglets = [
    { id: 'tous' as const, label: 'Tous', n: stats?.total },
    { id: 'attente' as const, label: '📤 En attente', n: stats?.envoye },
    { id: 'chaud' as const, label: '🔥 Vus, pas signés', n: stats?.chauds },
    { id: 'signe' as const, label: '✅ Signés', n: stats?.signe },
    { id: 'clos' as const, label: 'Refusés / expirés', n: (stats?.refuse ?? 0) + (stats?.expire ?? 0) },
  ]

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">✍️ Signatures électroniques</h1>
          <p className="text-sm text-gray-500 mt-1">Suivi des devis envoyés en signature (DocuSeal) — consultation seule</p>
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {([
              ['mois', 'Ce mois'],
              ['mois_dernier', 'Mois dernier'],
              ['3mois', '3 mois'],
              ['annee', 'Cette année'],
              ['tout', 'Tout'],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setPeriode(id)}
                className={`px-2.5 py-1 text-xs rounded-md border transition ${
                  periode === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center">
        <button onClick={() => setVoirMasques((v) => !v)}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 mr-2">
          {voirMasques ? '👁 Masquer les tests' : `🗂 Voir les masqués${stats?.masques ? ` (${stats.masques})` : ''}`}
        </button>
        <button onClick={charger} disabled={chargement}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
          {chargement ? '⏳ Actualisation…' : '🔄 Actualiser'}
        </button>
        </div>
      </div>

      {erreur && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <strong>Impossible de joindre DocuSeal.</strong> {erreur}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Carte titre="En attente de signature" valeur={euro(stats.montant_en_attente)}
            detail={`${stats.envoye + stats.ouvert} devis`} accent="text-blue-600" />
          <Carte titre="Signé" valeur={euro(stats.montant_signe)}
            detail={`${stats.signe} devis`} accent="text-emerald-600" />
          <Carte titre="🔥 À relancer" valeur={String(stats.chauds)}
            detail="ouverts, pas signés" accent="text-orange-600" />
          <Carte titre="Taux de signature" valeur={stats.taux_signature != null ? `${stats.taux_signature} %` : '—'}
            detail="signés / traités" accent="text-gray-900" />
          <Carte titre="Délai moyen" valeur={delai(stats.delai_moyen_h)}
            detail="envoi → signature" accent="text-gray-900" />
        </div>
      )}

      {stats && stats.acomptes_a_encaisser > 0 && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          💰 <strong>{stats.acomptes_a_encaisser} devis signé{stats.acomptes_a_encaisser > 1 ? 's' : ''}</strong> sans acompte enregistré — à encaisser ou à pointer.
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {onglets.map((o) => (
          <button key={o.id} onClick={() => setFiltre(o.id)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${
              filtre === o.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}>
            {o.label}{o.n != null && <span className="ml-1.5 opacity-70">{o.n}</span>}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {chargement && lignes.length === 0 ? (
          <div className="p-12 text-center text-gray-400">Chargement…</div>
        ) : visibles.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            Aucun envoi sur cette période
            {periode === 'mois' && <div className="text-xs mt-1">Essaie « Cette année » ou « Tout »</div>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Devis</th>
                  <th className="text-left px-4 py-3 font-medium">Client</th>
                  <th className="text-right px-4 py-3 font-medium">Montant</th>
                  <th className="text-left px-4 py-3 font-medium">Statut</th>
                  <th className="text-left px-4 py-3 font-medium">Envoyé</th>
                  <th className="text-left px-4 py-3 font-medium">Documents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibles.map((l) => {
                  const st = STATUTS[l.statut]
                  return (
                    <tr key={l.submission_id} className={l.chaud ? 'bg-orange-50/60' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {l.numero || <span className="text-gray-400 italic">hors devis</span>}
                        </div>
                        <div className="text-xs text-gray-500 max-w-[260px] truncate" title={l.titre || ''}>{l.titre}</div>
                        {l.envois > 1 && (
                          <div className="text-xs text-gray-400 mt-0.5">↻ envoyé {l.envois}×</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{l.client_nom || '—'}</div>
                        <div className="text-xs text-gray-500">{l.client_telephone || l.client_email || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                        {euro(l.montant_ttc)}
                        {l.statut === 'signe' && (
                          <div className={`text-xs font-normal ${l.acompte_regle ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {l.acompte_regle ? 'acompte reçu' : 'acompte à encaisser'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${st.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                        </span>
                        {l.chaud && <div className="text-xs text-orange-600 mt-1 font-medium">🔥 à appeler</div>}
                        {l.relance_conseillee && <div className="text-xs text-blue-600 mt-1">📨 relance conseillée</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {l.sent_at ? new Date(l.sent_at).toLocaleDateString('fr-FR') : '—'}
                        {l.jours_depuis_envoi != null && (
                          <div className="text-xs text-gray-400">
                            {l.jours_depuis_envoi === 0 ? "aujourd'hui" : `il y a ${l.jours_depuis_envoi} j`}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {l.pdf_signe_url && (
                            <a href={l.pdf_signe_url} target="_blank" rel="noreferrer"
                              className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50">📄 PDF signé</a>
                          )}
                          {l.certificat_url && (
                            <a href={l.certificat_url} target="_blank" rel="noreferrer"
                              className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">🔏 Certificat</a>
                          )}
                          {!l.pdf_signe_url && l.statut === 'signe' && (
                            <span className="text-xs text-gray-400">archivage en attente</span>
                          )}
                          <button onClick={() => basculerMasque(l)}
                            title={l.masque ? 'Réafficher dans le tableau' : 'Retirer du tableau (reste intact chez DocuSeal)'}
                            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-gray-700 hover:border-gray-400">
                            {l.masque ? '↩︎ Réafficher' : '🗂 Retirer'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Carte({ titre, valeur, detail, accent }: { titre: string; valeur: string; detail: string; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 mb-1">{titre}</div>
      <div className={`text-xl font-semibold ${accent}`}>{valeur}</div>
      <div className="text-xs text-gray-400 mt-0.5">{detail}</div>
    </div>
  )
}
