'use client'

import { useEffect, useMemo, useState } from 'react'

interface LeadPartenaire {
  id: string
  created_at: string
  nom: string | null
  telephone: string | null
  email: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
  type_porte: string | null
  dimensions: string | null
  message: string | null
  devis_numero: string | null
  devis_montant_ht: number | null
  devis_montant_ttc: number | null
  devis_marge_ht: number | null
  devis_pdf: boolean
  statut: 'nouveau' | 'bloque' | 'devis_genere'
  signe: boolean
  stage: string | null
  note: string | null
  envoi_statut: 'envoye' | 'erreur' | 'retenu' | null
  envoye_le: string | null
  envoi_erreur: string | null
  envoi_bloque: boolean
  envoi_mode: 'auto' | 'manuel' | null
}

interface Apercu {
  ok: boolean
  destinataire?: string
  sujet?: string
  html?: string
  pieces_jointes?: string[]
  avec_catalogue?: boolean
  erreur?: string
}

const TAUX_COMMISSION = 5 // % — décision gérant 01/09, cf. app/api/agent/route.ts::commissions_apporteur

function eur(v: number | null | undefined) {
  const n = Number(v || 0)
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function formatDateHeure(iso: string) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso.slice(0, 16).replace('T', ' ')
  }
}

const STATUT_LABEL: Record<string, string> = {
  nouveau: 'Nouveau',
  bloque: 'Bloqué',
  devis_genere: 'Devis généré',
  signe: 'Signé',
}
const STATUT_CLASSES: Record<string, string> = {
  nouveau: 'bg-gray-100 text-gray-600',
  bloque: 'bg-red-50 text-red-700',
  devis_genere: 'bg-blue-50 text-blue-700',
  signe: 'bg-green-50 text-green-700',
}

function statutEffectif(l: LeadPartenaire): string {
  return l.signe ? 'signe' : l.statut
}

export default function LeadsPartenairePage() {
  const [leads, setLeads] = useState<LeadPartenaire[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState<string>('all')
  const [ouverts, setOuverts] = useState<Set<string>>(new Set())
  const [apercuLead, setApercuLead] = useState<LeadPartenaire | null>(null)
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [apercuLoading, setApercuLoading] = useState(false)
  const [envoiEnCours, setEnvoiEnCours] = useState(false)

  useEffect(() => {
    fetch('/api/leads-partenaire?limit=500')
      .then((res) => res.json())
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (statutFilter !== 'all' && statutEffectif(l) !== statutFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const match =
          l.nom?.toLowerCase().includes(q) ||
          l.telephone?.toLowerCase().includes(q) ||
          l.ville?.toLowerCase().includes(q) ||
          l.devis_numero?.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [leads, statutFilter, search])

  const stats = useMemo(() => {
    const total = leads.length
    const nouveaux = leads.filter((l) => statutEffectif(l) === 'nouveau').length
    const bloques = leads.filter((l) => statutEffectif(l) === 'bloque').length
    const devisGeneres = leads.filter((l) => l.devis_numero)
    const totalTTC = devisGeneres.reduce((s, l) => s + Number(l.devis_montant_ttc || 0), 0)
    const signes = leads.filter((l) => l.signe)
    const caSigneHT = signes.reduce((s, l) => s + Number(l.devis_montant_ht || 0), 0)
    const commissionDue = Math.round(caSigneHT * (TAUX_COMMISSION / 100) * 100) / 100
    return { total, nouveaux, bloques, devisCount: devisGeneres.length, totalTTC, signesCount: signes.length, commissionDue }
  }, [leads])

  function toggleOuvert(id: string) {
    setOuverts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function ouvrirApercu(l: LeadPartenaire) {
    setApercuLead(l)
    setApercu(null)
    setApercuLoading(true)
    try {
      const res = await fetch(`/api/leads-partenaire/${l.id}/apercu`)
      const data = await res.json()
      setApercu(data)
    } catch (e) {
      setApercu({ ok: false, erreur: e instanceof Error ? e.message : String(e) })
    } finally {
      setApercuLoading(false)
    }
  }

  async function confirmerEnvoi() {
    if (!apercuLead) return
    setEnvoiEnCours(true)
    try {
      const res = await fetch(`/api/leads-partenaire/${apercuLead.id}/envoyer`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        alert('Échec de l’envoi : ' + (data.erreur || 'erreur inconnue'))
      } else {
        setLeads((prev) => prev.map((x) => x.id === apercuLead.id
          ? { ...x, envoi_statut: 'envoye', envoye_le: new Date().toISOString(), envoi_erreur: null }
          : x))
        setApercuLead(null)
        setApercu(null)
      }
    } catch (e) {
      alert('Erreur : ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setEnvoiEnCours(false)
    }
  }

  // « Ne pas envoyer » / « Autoriser l'envoi » : l'automate (cron envoi-leads)
  // saute les leads bloqués. Décision gérant 02/09/2026 : envoi automatique
  // 2 h après la génération, France et Belgique seulement.
  async function basculerBlocage(l: LeadPartenaire) {
    const bloque = !l.envoi_bloque
    try {
      const res = await fetch(`/api/leads-partenaire/${l.id}/bloquer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bloque }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        alert('Impossible de modifier : ' + (data.erreur || 'erreur inconnue'))
        return
      }
      setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, envoi_bloque: bloque } : x))
    } catch (e) {
      alert('Erreur : ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function handleDownload(numero: string) {
    try {
      const res = await fetch(`/api/devis-claudus/${encodeURIComponent(numero)}/download`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }))
        alert('Download impossible : ' + (err.error || res.statusText))
        return
      }
      const { url, filename } = await res.json()
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      if (filename) a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) {
      alert('Erreur : ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Leads partenaire</h1>
          <p className="text-sm text-gray-500 mt-1">
            Portes de garage reçues via le webhook partenaire — devis chiffrés automatiquement toutes les 15 min, envoi au client sur validation manuelle
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <div className="bg-white border rounded-lg px-3 py-1.5">
            <span className="text-gray-500">Leads : </span>
            <span className="font-semibold">{stats.total}</span>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
            <span className="text-blue-700">Devis générés : </span>
            <span className="font-semibold text-blue-800">{stats.devisCount}</span>
            <span className="text-blue-600 text-xs ml-1">({eur(stats.totalTTC)} TTC)</span>
          </div>
          {stats.bloques > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <span className="text-red-700">Bloqués : </span>
              <span className="font-semibold text-red-800">{stats.bloques}</span>
            </div>
          )}
          {stats.signesCount > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
              <span className="text-green-700">Signés : </span>
              <span className="font-semibold text-green-800">{stats.signesCount}</span>
              <span className="text-green-600 text-xs ml-1">
                (commission {TAUX_COMMISSION}% ≈ {eur(stats.commissionDue)})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (client, ville, tel, n° devis)..."
          className="border rounded-lg px-3 py-2 text-sm w-72 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />

        <div className="flex gap-1 bg-white border rounded-lg p-1">
          {[
            ['all', 'Tous'],
            ['nouveau', 'Nouveau'],
            ['bloque', 'Bloqué'],
            ['devis_genere', 'Devis généré'],
            ['signe', 'Signé'],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStatutFilter(val)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                statutFilter === val ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-gray-500">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 mb-2">
            {leads.length === 0 ? 'Aucun lead partenaire pour l\'instant' : 'Aucun résultat avec ces filtres'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Reçu le</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Demande</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Devis</th>
                <th className="text-right p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Vente TTC</th>
                <th className="text-right p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Marge HT</th>
                <th className="text-center p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">PDF</th>
                <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Envoi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((l) => {
                const st = statutEffectif(l)
                const ouvert = ouverts.has(l.id)
                return (
                  <tr key={l.id} className="hover:bg-gray-50 transition-colors align-top">
                    <td className="p-3 text-sm text-gray-600 whitespace-nowrap">{formatDateHeure(l.created_at)}</td>
                    <td className="p-3 text-sm">
                      <div className="font-medium text-gray-900">{l.nom || '—'}</div>
                      <div className="text-xs text-gray-500">
                        {[l.telephone, l.email].filter(Boolean).join(' • ') || '—'}
                      </div>
                      {(l.adresse || l.code_postal || l.ville) && (
                        <div className="text-xs text-gray-400">
                          {[l.adresse, l.code_postal, l.ville].filter(Boolean).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-sm max-w-xs">
                      <div className="text-gray-700">
                        {[l.type_porte, l.dimensions].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {l.message && (
                        <button
                          onClick={() => toggleOuvert(l.id)}
                          className="text-xs text-blue-600 hover:underline mt-0.5"
                        >
                          {ouvert ? 'masquer la demande' : 'voir la demande'}
                        </button>
                      )}
                      {ouvert && l.message && (
                        <pre className="mt-1 whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 border rounded p-2 max-w-sm">
                          {l.message}
                        </pre>
                      )}
                    </td>
                    <td className="p-3 text-sm">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUT_CLASSES[st]}`}>
                        {STATUT_LABEL[st]}
                      </span>
                      {st === 'bloque' && l.note && (
                        <div className="text-xs text-red-600 mt-1 max-w-xs">{l.note}</div>
                      )}
                    </td>
                    <td className="p-3 text-sm font-mono">{l.devis_numero || <span className="text-gray-300">—</span>}</td>
                    <td className="p-3 text-sm text-right whitespace-nowrap font-semibold">
                      {l.devis_numero ? eur(l.devis_montant_ttc) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="p-3 text-sm text-right whitespace-nowrap">
                      {l.devis_marge_ht !== null && l.devis_marge_ht !== undefined ? (
                        <span className="font-semibold text-green-700">{eur(l.devis_marge_ht)}</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {l.devis_numero && l.devis_pdf ? (
                        <button
                          onClick={() => handleDownload(l.devis_numero as string)}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors"
                          title="Télécharger le PDF"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
                          </svg>
                          PDF
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-3 text-sm">
                      {!l.devis_numero ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : l.envoi_statut === 'envoye' ? (
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                            Envoyé{l.envoi_mode === 'auto' ? ' · auto' : ''}
                          </span>
                          {l.envoye_le && (
                            <div className="text-xs text-gray-400 mt-0.5">{formatDateHeure(l.envoye_le)}</div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 items-start">
                          {l.envoi_statut === 'erreur' && (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700"
                              title={l.envoi_erreur || ''}
                            >
                              Échec
                            </span>
                          )}
                          {l.envoi_statut === 'retenu' && (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700"
                              title={l.envoi_erreur || ''}
                            >
                              Retenu{l.envoi_erreur ? ` · ${l.envoi_erreur.slice(0, 40)}` : ''}
                            </span>
                          )}
                          {l.envoi_bloque ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                              ⛔ Ne pas envoyer
                            </span>
                          ) : !l.envoi_statut && l.email ? (
                            <span className="text-xs text-gray-400" title="Envoi automatique 2 h après la génération, lun–sam 9h–19h, France et Belgique">
                              ⏳ part automatiquement
                            </span>
                          ) : null}
                          <div className="flex gap-1">
                            <button
                              onClick={() => ouvrirApercu(l)}
                              disabled={!l.email}
                              title={l.email ? 'Aperçu puis envoi' : 'Ce client n’a pas d’e-mail'}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-900 text-white text-xs font-medium rounded hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                            >
                              ✉️ {l.envoi_statut === 'erreur' ? 'Réessayer' : 'Envoyer'}
                            </button>
                            <button
                              onClick={() => basculerBlocage(l)}
                              title={l.envoi_bloque ? 'Ré-autoriser l’envoi automatique' : 'Empêcher l’envoi automatique'}
                              className="inline-flex items-center px-2 py-1 border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-100 transition-colors"
                            >
                              {l.envoi_bloque ? 'Autoriser' : 'Ne pas envoyer'}
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        ℹ️ Envoi automatique : chaque devis part seul 2 h après sa génération (lun–sam, 9h–19h), sauf
        &quot;Ne pas envoyer&quot;. France et Belgique seulement (Belgique : +70 € HT de livraison) ; les autres pays
        sont retenus, à envoyer à la main si besoin.
      </p>

      {/* Modale d'aperçu — montre l'e-mail EXACT avant tout envoi réel */}
      {apercuLead && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { setApercuLead(null); setApercu(null) }}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="font-semibold text-gray-900">Aperçu — {apercuLead.nom || 'Client'}</h2>
                <p className="text-xs text-gray-500">Rien n&apos;est envoyé tant que tu ne cliques pas sur &quot;Envoyer&quot;.</p>
              </div>
              <button
                onClick={() => { setApercuLead(null); setApercu(null) }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {apercuLoading ? (
                <div className="p-8 text-center text-gray-500 text-sm">Préparation de l&apos;aperçu...</div>
              ) : !apercu?.ok ? (
                <div className="p-8 text-center text-red-600 text-sm">
                  {apercu?.erreur || 'Aperçu indisponible'}
                </div>
              ) : (
                <>
                  <div className="px-4 py-3 border-b bg-gray-50 text-sm space-y-1">
                    <div><span className="text-gray-500">À : </span><span className="font-medium">{apercu.destinataire}</span></div>
                    <div><span className="text-gray-500">Objet : </span><span className="font-medium">{apercu.sujet}</span></div>
                    <div>
                      <span className="text-gray-500">Pièces jointes : </span>
                      <span className="font-medium">{apercu.pieces_jointes?.join(' · ')}</span>
                      {!apercu.avec_catalogue && (
                        <span className="text-xs text-gray-400 ml-1">(pas de catalogue — famille non couverte)</span>
                      )}
                    </div>
                  </div>
                  <iframe
                    title="Aperçu de l'e-mail"
                    srcDoc={apercu.html}
                    className="w-full"
                    style={{ height: '420px', border: 'none' }}
                  />
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
              <button
                onClick={() => { setApercuLead(null); setApercu(null) }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmerEnvoi}
                disabled={!apercu?.ok || envoiEnCours}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {envoiEnCours ? 'Envoi...' : 'Envoyer maintenant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
