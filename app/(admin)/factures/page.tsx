'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

// ---------- types ----------
interface FactureRow {
  id: string; numero: string; type: string; statut: string
  client_nom: string; client_email: string | null; devis_numero: string | null
  total_ht: number; total_ttc: number; paye: number; reste: number
  date_echeance: string; emise_le: string; emise_par: string | null
  pdf_path: string | null; pdf_a_regenerer: boolean
  annulee_par: string | null; avoir_de: string | null
}
interface MoisRow { mois: string; facture_ttc: number; encaisse: number; nb: number; marge_ht: number | null }
interface TvaRow { taux: number; base_ht_facturee: number; tva_facturee: number; tva_encaissee: number }
interface ImpayeRow {
  numero: string; client_nom: string; total_ttc: number; paye: number; restant: number
  date_echeance: string; jours_retard: number; devis_numero: string | null; texte_relance: string
}

// ---------- helpers ----------
function eur(v: number | null | undefined) {
  return Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
function dateFr(iso: string | null | undefined) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('fr-FR') } catch { return String(iso).slice(0, 10) }
}
function moisFr(m: string) {
  const [a, mm] = m.split('-')
  const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  return `${noms[parseInt(mm, 10) - 1]} ${a}`
}
function premierDuMois(decalage = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + decalage)
  return d.toISOString().slice(0, 10)
}
function dernierDuMois(decalage = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + decalage + 1); d.setDate(0)
  return d.toISOString().slice(0, 10)
}

// En dev local uniquement : /compta?env=test fait suivre env=test aux routes
// API (qui ne l'acceptent qu'en NODE_ENV !== production) — démo sans données réelles.
function envQS(prefixe: '?' | '&') {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('env') === 'test' ? `${prefixe}env=test` : ''
}

const TYPE_LABELS: Record<string, string> = { facture: 'Facture', acompte: 'Acompte', solde: 'Solde', avoir: 'Avoir' }
const STATUT_STYLE: Record<string, string> = {
  emise: 'bg-blue-100 text-blue-800',
  partiellement_payee: 'bg-orange-100 text-orange-800',
  payee: 'bg-green-100 text-green-800',
}
const STATUT_LABELS: Record<string, string> = {
  emise: 'Émise', partiellement_payee: 'Partiellement payée', payee: 'Payée',
}

function Carte({ label, valeur, accent }: { label: string; valeur: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border px-4 py-3"
         style={{ background: 'var(--surface-1)', borderColor: 'var(--border-default)' }}>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-red-600' : ''}`}
           style={accent ? {} : { color: 'var(--text-primary)' }}>{valeur}</div>
    </div>
  )
}

// ---------- modal paiement ----------
function ModalPaiement({ facture, onFerme, onOk }: {
  facture: FactureRow; onFerme: () => void; onOk: () => void
}) {
  const [montant, setMontant] = useState(String(facture.reste.toFixed(2)))
  const [moyen, setMoyen] = useState('virement')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const refObligatoire = moyen === 'cheque' || moyen === 'virement'

  async function envoyer() {
    setErreur('')
    if (refObligatoire && !reference.trim()) {
      setErreur('Référence obligatoire (n° de chèque, réf. virement) — traçabilité.')
      return
    }
    setEnvoi(true)
    try {
      const r = await fetch(`/api/compta/factures/${facture.numero}/paiement` + envQS('?'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ montant: parseFloat(montant.replace(',', '.')), moyen, date, reference: reference || null }),
      })
      const d = await r.json()
      if (!r.ok) { setErreur(d.error || 'Erreur'); setEnvoi(false); return }
      onOk()
    } catch { setErreur('Erreur réseau'); setEnvoi(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-xl border p-5 w-full max-w-md"
           style={{ background: 'var(--surface-1)', borderColor: 'var(--border-default)' }}>
        <h3 className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Saisir un paiement — {facture.numero}
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          {facture.client_nom} · reste à payer {eur(facture.reste)}
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Montant (€)</span>
            <input value={montant} onChange={(e) => setMontant(e.target.value)} inputMode="decimal"
                   className="mt-1 w-full rounded border px-3 py-2 bg-transparent"
                   style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </label>
          <label className="block text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Moyen</span>
            <select value={moyen} onChange={(e) => setMoyen(e.target.value)}
                    className="mt-1 w-full rounded border px-3 py-2 bg-transparent"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
              <option value="virement">Virement</option>
              <option value="cheque">Chèque</option>
              <option value="cb_monetico">Carte bancaire</option>
              <option value="especes">Espèces</option>
            </select>
          </label>
          <label className="block text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                   className="mt-1 w-full rounded border px-3 py-2 bg-transparent"
                   style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </label>
          <label className="block text-sm">
            <span style={{ color: 'var(--text-secondary)' }}>
              Référence {refObligatoire ? '(obligatoire)' : '(optionnelle)'}
            </span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
                   placeholder="CHQ n° … / VIR réf. …"
                   className="mt-1 w-full rounded border px-3 py-2 bg-transparent"
                   style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </label>
          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
            Après saisie, régénérer le PDF : <code>python3 facturer.py pdf {facture.numero}</code>
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onFerme} className="px-3 py-1.5 rounded border text-sm"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Annuler</button>
            <button onClick={envoyer} disabled={envoi}
                    className="px-3 py-1.5 rounded text-sm font-semibold text-white bg-green-600 disabled:opacity-50">
              {envoi ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- brouillons en attente d'émission ----------
// L'agent (ou une route) prépare des brouillons ; ils n'apparaissaient NULLE
// PART — la liste des factures les exclut à raison, mais le bouton d'émission
// n'existait pas. Résultat vécu le 27/08 : un brouillon prêt, et personne ne
// pouvait appuyer. L'émission est LE geste humain de la chaîne, il lui faut
// un bouton.
type BrouillonRow = {
  id: string; type: string; client_nom: string; devis_numero: string | null
  nb_lignes: number; total_ht: number; total_ttc: number
  cree_par: string | null; cree_le: string
}

type ProformaRow = {
  id: string; numero: string; statut: string; client_nom: string | null
  devis_numero: string | null; total_ttc: number; cree_le: string
  expiree: boolean; facture: { numero: string | null; statut: string } | null
}

/** LES PROFORMAS — appels de fonds, PAS des factures.
 *  Bloc distinct de la liste des factures, exprès : rien de ce qui est ici
 *  n'a de valeur comptable, et rien ne doit entrer dans les totaux. */
function BlocProformas({ onConverti }: { onConverti: () => void }) {
  const [rows, setRows] = useState<ProformaRow[]>([])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const charger = useCallback(() => {
    fetch('/api/compta/proformas' + envQS('?'))
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(console.error)
  }, [])
  useEffect(charger, [charger])

  const agir = async (numero: string, action: 'convertir' | 'supprimer') => {
    let regle_le: string | undefined
    if (action === 'convertir') {
      const saisie = window.prompt(
        'Quel jour l’argent est-il arrivé ? (AAAA-MM-JJ)\n\nC’est cette date qui figurera sur la facture.',
        new Date().toISOString().slice(0, 10))
      if (!saisie) return
      regle_le = saisie.trim()
    } else if (!window.confirm('Supprimer cette demande de règlement ?\n\nRien n’a été facturé : aucune trace, rien à annuler.')) return

    setOccupe(numero); setMessage(null)
    try {
      const r = await fetch('/api/compta/proformas' + envQS('?'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, action, regle_le }),
      })
      const d = await r.json()
      if (!r.ok) { setMessage(`Refusé : ${d.error}`); return }
      setMessage(action === 'convertir'
        ? 'Facture préparée — elle vous attend juste en dessous, il reste à l’émettre.'
        : 'Demande supprimée.')
      charger(); onConverti()
    } catch { setMessage('Erreur réseau') } finally { setOccupe(null) }
  }

  if (!rows.length && !message) return null
  return (
    <div className="mb-5 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Demandes de règlement (avant facture) {rows.length ? `(${rows.length})` : ''}
      </h3>
      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
        Pour demander un paiement <b>avant</b> de livrer : on ne peut pas encore faire de facture,
        alors on envoie ce document (une « proforma »). Le client paie, vous cliquez sur
        « Le client a payé », et la facture se crée toute seule. S’il ne paie pas, vous supprimez :
        rien n’a été facturé, rien à annuler.
      </p>
      {message && <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{message}</p>}
      {rows.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-3 py-2 border-t text-sm"
             style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
          <span className="font-mono text-xs">{p.numero}</span>
          <span className="font-medium">{p.client_nom || '(sans nom)'}</span>
          {p.devis_numero && <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{p.devis_numero}</span>}
          <span>{eur(p.total_ttc)} TTC</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>du {dateFr(p.cree_le)}</span>
          {p.expiree && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
              expirée — ne pas encaisser sur ce prix
            </span>
          )}
          {p.statut === 'convertie' && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">
              convertie → {p.facture?.numero || 'brouillon'}
            </span>
          )}
          <span className="ml-auto flex gap-2">
            <a href={`/api/compta/proformas/${encodeURIComponent(p.numero)}/pdf`} target="_blank" rel="noreferrer"
               className="px-3 py-1 rounded text-xs border"
               style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>PDF</a>
            {p.statut === 'active' && (
              <>
                <button onClick={() => agir(p.numero, 'convertir')} disabled={occupe === p.numero}
                        className="px-3 py-1 rounded text-xs font-semibold text-white bg-green-700 hover:bg-green-800 disabled:opacity-50">
                  {occupe === p.numero ? '…' : 'Le client a payé → créer la facture'}
                </button>
                <button onClick={() => agir(p.numero, 'supprimer')} disabled={occupe === p.numero}
                        className="px-3 py-1 rounded text-xs border hover:bg-red-50"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                  Supprimer
                </button>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function BlocBrouillons({ onEmis }: { onEmis: () => void }) {
  const [rows, setRows] = useState<BrouillonRow[]>([])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const charger = useCallback(() => {
    fetch('/api/compta/factures/brouillons' + envQS('?'))
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(console.error)
  }, [])
  useEffect(charger, [charger])

  const agir = async (id: string, action: 'emettre' | 'supprimer') => {
    if (action === 'emettre' && !window.confirm(
      'Émettre cette facture ?\n\nUn numéro définitif sera attribué et la chaîne comptable verrouillée. Cette action ne se défait que par un avoir.')) return
    if (action === 'supprimer' && !window.confirm('Supprimer ce brouillon ? (aucune trace, aucun numéro consommé)')) return
    setOccupe(id); setMessage(null)
    try {
      const r = await fetch('/api/compta/factures/brouillons' + envQS('?'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, acteur: 'CRM' }),
      })
      const d = await r.json()
      if (!r.ok) { setMessage(`Refusé : ${d.error}`); return }
      setMessage(action === 'emettre' ? `Facture émise : ${d.numero}` : 'Brouillon supprimé.')
      charger(); onEmis()
    } catch { setMessage('Erreur réseau') } finally { setOccupe(null) }
  }

  if (!rows.length && !message) return null
  return (
    <div className="mb-5 rounded-lg border p-4" style={{ borderColor: 'var(--border-default)', background: 'var(--surface-2)' }}>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Brouillons en attente d&apos;émission {rows.length ? `(${rows.length})` : ''}
      </h3>
      {message && <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{message}</p>}
      {rows.map((b) => (
        <div key={b.id} className="flex flex-wrap items-center gap-3 py-2 border-t text-sm"
             style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
          <span className="font-medium">{b.client_nom || '(sans nom)'}</span>
          {b.devis_numero && <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{b.devis_numero}</span>}
          <span>{eur(b.total_ttc)} TTC</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {b.nb_lignes} ligne{b.nb_lignes > 1 ? 's' : ''} · préparé par {b.cree_par || '?'} le {dateFr(b.cree_le)}
          </span>
          <span className="ml-auto flex gap-2">
            <button onClick={() => agir(b.id, 'emettre')} disabled={occupe === b.id}
                    className="px-3 py-1 rounded text-xs font-semibold text-white bg-green-700 hover:bg-green-800 disabled:opacity-50">
              {occupe === b.id ? '…' : 'Émettre'}
            </button>
            <button onClick={() => agir(b.id, 'supprimer')} disabled={occupe === b.id}
                    className="px-3 py-1 rounded text-xs border hover:bg-red-50"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
              Supprimer
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------- onglets ----------
function OngletFactures() {
  const [rows, setRows] = useState<FactureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statut, setStatut] = useState('all')
  const [type, setType] = useState('all')
  const [paiementPour, setPaiementPour] = useState<FactureRow | null>(null)

  const charger = useCallback(() => {
    setLoading(true)
    fetch('/api/compta/factures?limit=500' + envQS('&'))
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])
  useEffect(charger, [charger])

  const filtres = useMemo(() => rows.filter((r) => {
    if (statut !== 'all' && r.statut !== statut) return false
    if (type !== 'all' && r.type !== type) return false
    if (q) {
      const s = q.toLowerCase()
      if (!r.numero.toLowerCase().includes(s) && !r.client_nom.toLowerCase().includes(s)
          && !(r.devis_numero || '').toLowerCase().includes(s)) return false
    }
    return true
  }), [rows, statut, type, q])

  const stats = useMemo(() => ({
    nb: filtres.length,
    ttc: filtres.reduce((s, r) => s + (r.type === 'avoir' ? -r.total_ttc : r.total_ttc), 0),
    paye: filtres.reduce((s, r) => s + r.paye, 0),
    reste: filtres.filter((r) => r.type !== 'avoir').reduce((s, r) => s + r.reste, 0),
  }), [filtres])

  return (
    <div>
      <BlocProformas onConverti={charger} />
      <BlocBrouillons onEmis={charger} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Carte label="Factures" valeur={String(stats.nb)} />
        <Carte label="Total TTC (avoirs déduits)" valeur={eur(stats.ttc)} />
        <Carte label="Encaissé" valeur={eur(stats.paye)} />
        <Carte label="Reste à encaisser" valeur={eur(stats.reste)} accent={stats.reste > 0} />
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher n°, client, devis…"
               className="rounded border px-3 py-1.5 text-sm bg-transparent"
               style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        <select value={statut} onChange={(e) => setStatut(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm bg-transparent"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
          <option value="all">Tous statuts</option>
          <option value="emise">Émise</option>
          <option value="partiellement_payee">Partiellement payée</option>
          <option value="payee">Payée</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}
                className="rounded border px-2 py-1.5 text-sm bg-transparent"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
          <option value="all">Tous types</option>
          <option value="facture">Facture</option>
          <option value="acompte">Acompte</option>
          <option value="solde">Solde</option>
          <option value="avoir">Avoir</option>
        </select>
      </div>
      {loading ? <p style={{ color: 'var(--text-muted)' }}>Chargement…</p> : filtres.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
          Aucune facture émise pour l&apos;instant.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                {['N°', 'Date', 'Type', 'Client', 'Devis', 'TTC', 'Réglé', 'Reste', 'Statut', 'Par', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtres.map((r) => (
                <tr key={r.id} className="border-t"
                    style={{ borderColor: 'var(--border-subtle)',
                             color: r.annulee_par ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">
                    <span className={r.annulee_par ? 'line-through' : ''}>{r.numero}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{dateFr(r.emise_le)}</td>
                  <td className="px-3 py-2">{TYPE_LABELS[r.type] || r.type}</td>
                  <td className="px-3 py-2">{r.client_nom}</td>
                  <td className="px-3 py-2 font-mono">{r.devis_numero || '—'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className={r.annulee_par ? 'line-through' : ''}>
                      {eur(r.type === 'avoir' ? -r.total_ttc : r.total_ttc)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{r.type === 'avoir' || r.annulee_par ? '—' : eur(r.paye)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                    {r.type === 'avoir' || r.annulee_par ? '—' : eur(r.reste)}
                  </td>
                  <td className="px-3 py-2">
                    {r.annulee_par ? (
                      // « Émise » sur une facture annulée était le vrai piège :
                      // elle apparaissait comme due, à côté de celle qui la
                      // remplace. On dit maintenant par quoi elle est annulée.
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700"
                            title={`Annulée par l'avoir ${r.annulee_par}`}>
                        Annulée · {r.annulee_par}
                      </span>
                    ) : r.type === 'avoir' ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                            title={r.avoir_de ? `Annule la facture ${r.avoir_de}` : undefined}>
                        Avoir{r.avoir_de ? ` · annule ${r.avoir_de}` : ''}
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUT_STYLE[r.statut] || ''}`}>
                        {STATUT_LABELS[r.statut] || r.statut}
                      </span>
                    )}
                    {r.pdf_a_regenerer && (
                      <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800"
                            title="PDF antérieur au dernier paiement : rouvrez-le, il se régénère avec la mention d'acquittement">
                        PDF à régénérer
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{r.emise_par || ''}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.pdf_path && (
                      <a href={`/api/compta/factures/${r.numero}/pdf`} target="_blank" rel="noreferrer"
                         className="mr-2" title="Télécharger le PDF">⬇️</a>
                    )}
                    {r.type !== 'avoir' && !r.annulee_par && r.statut !== 'payee' && (
                      <button onClick={() => setPaiementPour(r)} title="Saisir un paiement">💶</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paiementPour && (
        <ModalPaiement facture={paiementPour} onFerme={() => setPaiementPour(null)}
                       onOk={() => { setPaiementPour(null); charger() }} />
      )}
    </div>
  )
}

function OngletDashboard() {
  const [data, setData] = useState<{ mois: MoisRow[]; courant: MoisRow; total_impayes: number; nb_impayes: number } | null>(null)
  useEffect(() => {
    fetch('/api/compta/dashboard' + envQS('?')).then((r) => r.json()).then(setData).catch(console.error)
  }, [])
  if (!data) return <p style={{ color: 'var(--text-muted)' }}>Chargement…</p>
  const max = Math.max(1, ...data.mois.map((m) => Math.max(m.facture_ttc, m.encaisse)))
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Carte label={`Facturé — ${moisFr(data.courant.mois)}`} valeur={eur(data.courant.facture_ttc)} />
        <Carte label={`Encaissé — ${moisFr(data.courant.mois)}`} valeur={eur(data.courant.encaisse)} />
        <Carte label="Impayés (total)" valeur={`${eur(data.total_impayes)} · ${data.nb_impayes}`} accent={data.total_impayes > 0} />
        <Carte label={`Marge HT — ${moisFr(data.courant.mois)}`}
               valeur={data.courant.marge_ht == null ? 'n.c.' : eur(data.courant.marge_ht)} />
      </div>
      {data.mois.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Aucune facture sur les 12 derniers mois.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                {['Mois', 'Facturé TTC', 'Encaissé', '', 'Nb', 'Marge HT'].map((h, i) => (
                  <th key={i} className="text-left px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.mois.map((m) => (
                <tr key={m.mois} className="border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                  <td className="px-3 py-2 whitespace-nowrap">{moisFr(m.mois)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{eur(m.facture_ttc)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{eur(m.encaisse)}</td>
                  <td className="px-3 py-2 w-1/3 min-w-[140px]">
                    <div className="h-2 rounded" style={{ width: `${(m.facture_ttc / max) * 100}%`, background: 'var(--text-dim)' }} />
                    <div className="h-2 rounded mt-0.5 bg-green-500" style={{ width: `${(m.encaisse / max) * 100}%` }} />
                  </td>
                  <td className="px-3 py-2">{m.nb}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{m.marge_ht == null ? 'n.c.' : eur(m.marge_ht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs mt-2" style={{ color: 'var(--text-dim)' }}>
        Barre grise : facturé · barre verte : encaissé. Marge « n.c. » quand aucune facture du mois n&apos;est liée à un devis avec prix d&apos;achat.
      </p>
    </div>
  )
}

function OngletTva() {
  const [debut, setDebut] = useState(premierDuMois(0))
  const [fin, setFin] = useState(dernierDuMois(0))
  const [rows, setRows] = useState<TvaRow[] | null>(null)
  const charger = useCallback(() => {
    setRows(null)
    fetch(`/api/compta/tva?debut=${debut}&fin=${fin}` + envQS('&'))
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(console.error)
  }, [debut, fin])
  useEffect(charger, [charger])

  function preset(p: 'mois' | 'mois-1' | 'trimestre') {
    if (p === 'mois') { setDebut(premierDuMois(0)); setFin(dernierDuMois(0)) }
    if (p === 'mois-1') { setDebut(premierDuMois(-1)); setFin(dernierDuMois(-1)) }
    if (p === 'trimestre') {
      const d = new Date(); const q = Math.floor(d.getMonth() / 3) * 3
      setDebut(new Date(d.getFullYear(), q, 1).toISOString().slice(0, 10))
      setFin(new Date(d.getFullYear(), q + 3, 0).toISOString().slice(0, 10))
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        {[['mois', 'Mois en cours'], ['mois-1', 'Mois précédent'], ['trimestre', 'Trimestre']].map(([k, l]) => (
          <button key={k} onClick={() => preset(k as 'mois' | 'mois-1' | 'trimestre')}
                  className="px-3 py-1.5 rounded border text-sm"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>{l}</button>
        ))}
        <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)}
               className="rounded border px-2 py-1.5 text-sm bg-transparent"
               style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <input type="date" value={fin} onChange={(e) => setFin(e.target.value)}
               className="rounded border px-2 py-1.5 text-sm bg-transparent"
               style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
      </div>
      {rows === null ? <p style={{ color: 'var(--text-muted)' }}>Chargement…</p> : rows.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Aucune TVA sur la période.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border max-w-2xl" style={{ borderColor: 'var(--border-default)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
                {['Taux', 'Base HT facturée', 'TVA facturée', 'TVA encaissée'].map((h) => (
                  <th key={h} className="text-left px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.taux} className="border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                  <td className="px-3 py-2 font-semibold">{Number(r.taux).toLocaleString('fr-FR')} %</td>
                  <td className="px-3 py-2 text-right">{eur(r.base_ht_facturee)}</td>
                  <td className="px-3 py-2 text-right">{eur(r.tva_facturee)}</td>
                  <td className="px-3 py-2 text-right">{eur(r.tva_encaissee)}</td>
                </tr>
              ))}
              <tr className="border-t font-bold" style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{eur(rows.reduce((s, r) => s + Number(r.base_ht_facturee), 0))}</td>
                <td className="px-3 py-2 text-right">{eur(rows.reduce((s, r) => s + Number(r.tva_facturee), 0))}</td>
                <td className="px-3 py-2 text-right">{eur(rows.reduce((s, r) => s + Number(r.tva_encaissee), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="rounded-lg border px-4 py-3 mt-4 max-w-2xl text-sm"
           style={{ background: 'var(--surface-3)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
        <b>Exigibilité :</b> ventes de matériel (biens) → TVA due à la <b>facturation</b> (colonne « TVA facturée ») ·
        pose / prestations → TVA due à l&apos;<b>encaissement</b> (colonne « TVA encaissée »).
        Les avoirs sont déjà déduits. À reporter sur la CA3 avec votre expert-comptable.
      </div>
    </div>
  )
}

function OngletImpayes() {
  const [rows, setRows] = useState<ImpayeRow[] | null>(null)
  const [copie, setCopie] = useState('')
  useEffect(() => {
    fetch('/api/compta/impayes').then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : [])).catch(console.error)
  }, [])
  async function copier(r: ImpayeRow) {
    await navigator.clipboard.writeText(r.texte_relance)
    setCopie(r.numero); setTimeout(() => setCopie(''), 2000)
  }
  if (rows === null) return <p style={{ color: 'var(--text-muted)' }}>Chargement…</p>
  if (rows.length === 0)
    return <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Aucun impayé 🎉</p>
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
            {['N°', 'Client', 'Échéance', 'Retard', 'Réglé', 'Reste', 'Relance'].map((h) => (
              <th key={h} className="text-left px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.numero} className="border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
              <td className="px-3 py-2 font-mono">{r.numero}</td>
              <td className="px-3 py-2">{r.client_nom}</td>
              <td className="px-3 py-2">{dateFr(r.date_echeance)}</td>
              <td className={`px-3 py-2 font-semibold ${Number(r.jours_retard) > 0 ? 'text-red-600' : ''}`}>
                {Number(r.jours_retard) > 0 ? `${r.jours_retard} j` : '—'}
              </td>
              <td className="px-3 py-2 text-right">{eur(r.paye)}</td>
              <td className="px-3 py-2 text-right font-bold">{eur(r.restant)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <button onClick={() => copier(r)} className="px-2 py-1 rounded border text-xs"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                  {copie === r.numero ? '✓ Copié' : '📋 Copier la relance'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OngletExports() {
  const [debut, setDebut] = useState(premierDuMois(-1))
  const [fin, setFin] = useState(dernierDuMois(-1))
  const blocs = [
    { titre: 'Journal des ventes', desc: 'Une ligne par facture/avoir : bases et TVA par taux, comptes produits (707 biens · 706 services · 708 mixte), TTC. Avoirs en négatif.', url: `/api/compta/exports/journal-ventes?debut=${debut}&fin=${fin}` },
    { titre: 'Encaissements', desc: 'Une ligne par paiement : date, facture, client, moyen, compte de trésorerie (512 / 5112 / 53), référence, montant.', url: `/api/compta/exports/encaissements?debut=${debut}&fin=${fin}` },
  ]
  return (
    <div className="max-w-2xl">
      <div className="flex items-end gap-2 mb-4">
        <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Du
          <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)}
                 className="ml-2 rounded border px-2 py-1.5 text-sm bg-transparent"
                 style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </label>
        <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          au
          <input type="date" value={fin} onChange={(e) => setFin(e.target.value)}
                 className="ml-2 rounded border px-2 py-1.5 text-sm bg-transparent"
                 style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </label>
      </div>
      <div className="space-y-3">
        {blocs.map((b) => (
          <div key={b.titre} className="rounded-lg border px-4 py-3 flex items-center justify-between gap-4"
               style={{ background: 'var(--surface-1)', borderColor: 'var(--border-default)' }}>
            <div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{b.titre}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{b.desc}</div>
            </div>
            <a href={b.url} className="px-3 py-1.5 rounded text-sm font-semibold text-white bg-blue-600 whitespace-nowrap">
              ⬇ CSV
            </a>
          </div>
        ))}
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-dim)' }}>
        Comptes PCG indicatifs — à valider avec l&apos;expert-comptable. CSV séparé par « ; », encodage UTF-8 (Excel FR).
      </p>
    </div>
  )
}

// ---------- page ----------
const ONGLETS = [
  { id: 'factures', label: '🧾 Factures' },
  { id: 'dashboard', label: '📊 Dashboard' },
  { id: 'tva', label: '💰 TVA' },
  { id: 'impayes', label: '🔴 Impayés' },
  { id: 'exports', label: '📤 Exports' },
] as const

export default function FacturesPage() {
  const [onglet, setOnglet] = useState<(typeof ONGLETS)[number]['id']>('factures')
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Factures</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Factures, encaissements, TVA — émission via Claude/Hermès (<code>facturer.py</code>)
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {ONGLETS.map((o) => (
            <button key={o.id} onClick={() => setOnglet(o.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${onglet === o.id ? 'text-white bg-blue-600' : ''}`}
                    style={onglet === o.id ? {} : { color: 'var(--text-secondary)' }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {onglet === 'factures' && <OngletFactures />}
      {onglet === 'dashboard' && <OngletDashboard />}
      {onglet === 'tva' && <OngletTva />}
      {onglet === 'impayes' && <OngletImpayes />}
      {onglet === 'exports' && <OngletExports />}
    </div>
  )
}
