'use client'

import { useState, useEffect } from 'react'

interface CommercialOption {
  id: string
  nom: string
}

interface ClientHit {
  id: string
  nom: string
  telephone: string | null
  email: string | null
  ville: string | null
  code_postal: string | null
  adresse: string | null
}

interface LeadHit {
  id: string
  contact_name: string
  telephone: string | null
}

interface MatchPayload {
  mode: 'existing' | 'from_lead' | 'new' | 'ambiguous'
  client: ClientHit | ClientHit[] | null
  lead: LeadHit | null
  suggested: {
    nom: string
    telephone: string
    email: string
    ville: string
    code_postal: string
    adresse: string
    titre: string
    description: string
    besoin: string
    montant_estime: number | null
    pipeline_stage: string
    commercial_id: string | null
  }
}

type FormState = MatchPayload['suggested'] & {
  selected_client_id?: string
}

interface Props {
  cdr_id: number | null
  onClose: () => void
  onCreated: () => void
}

const MODE_LABELS: Record<MatchPayload['mode'], string> = {
  existing: '🟢 Client existant',
  from_lead: '🔵 Lead LBC trouvé',
  ambiguous: '⚠️ Plusieurs clients trouvés (choisir lequel)',
  new: '🆕 Nouveau client',
}

export default function CreateAffaireModal({ cdr_id, onClose, onCreated }: Props) {
  const [data, setData] = useState<MatchPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [commerciaux, setCommerciaux] = useState<CommercialOption[]>([])

  useEffect(() => {
    if (!cdr_id) {
      setData(null)
      setForm(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/ringover/to-affaire?cdr_id=${cdr_id}`).then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || 'match failed')
        return d as MatchPayload
      }),
      fetch('/api/commerciaux').then(async (r) => {
        if (!r.ok) return []
        const d = await r.json()
        return Array.isArray(d) ? d : d.commerciaux || []
      }),
    ])
      .then(([d, comms]) => {
        setData(d)
        setForm({ ...d.suggested })
        setCommerciaux(comms as CommercialOption[])
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'unknown error')
      })
      .finally(() => setLoading(false))
  }, [cdr_id])

  async function submit() {
    if (!cdr_id || !data || !form) return
    setSubmitting(true)
    setError(null)
    try {
      // Si mode 'ambiguous' et l'user a choisi un client → bascule vers 'existing'
      let mode: 'existing' | 'from_lead' | 'new' = 'new'
      if (data.mode === 'existing') mode = 'existing'
      else if (data.mode === 'from_lead') mode = 'from_lead'
      else if (data.mode === 'ambiguous' && form.selected_client_id) mode = 'existing'
      else if (data.mode === 'ambiguous') {
        throw new Error('Choisissez un client dans la liste avant de créer l\'affaire')
      }

      const client_data: Record<string, unknown> = {
        nom: form.nom,
        telephone: form.telephone || null,
        email: form.email || null,
        ville: form.ville || null,
        code_postal: form.code_postal || null,
        adresse: form.adresse || null,
      }

      if (mode === 'existing') {
        const c = !Array.isArray(data.client) ? data.client : null
        const fromList = Array.isArray(data.client) ? data.client.find((x) => x.id === form.selected_client_id) : null
        const chosen = c || fromList
        if (!chosen) throw new Error('Client introuvable')
        client_data.id = chosen.id
      }
      if (mode === 'from_lead' && data.lead) {
        client_data.lead_id = data.lead.id
      }

      const affaire_data = {
        titre: form.titre,
        description: form.description || null,
        pipeline_stage: form.pipeline_stage || 'nouveau',
        montant_estime: form.montant_estime ? Number(form.montant_estime) : 0,
        commercial_id: form.commercial_id || null,
      }

      const r = await fetch('/api/ringover/to-affaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdr_id, mode, client_data, affaire_data }),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res?.error || 'Create failed')
      onCreated()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!cdr_id) return null

  const isAmbiguous = data?.mode === 'ambiguous'
  const ambiguousClients = isAmbiguous && Array.isArray(data?.client) ? data.client : []

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
        style={{ background: 'var(--surface-2, #1a1d2a)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            📋 Créer une affaire
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="opacity-60 hover:opacity-100 text-xl leading-none"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="opacity-70 py-8 text-center">⏳ Analyse de l&apos;appel...</div>
        ) : !data || !form ? (
          <div className="opacity-70 py-8 text-center">
            {error ? <span className="text-red-500">⚠️ {error}</span> : 'Erreur de chargement'}
          </div>
        ) : (
          <>
            <div className="mb-3 px-3 py-2 rounded text-sm" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="font-semibold">{MODE_LABELS[data.mode]}</div>
              {data.mode === 'existing' && !Array.isArray(data.client) && data.client && (
                <div className="opacity-70 text-xs">{data.client.nom} — {data.client.telephone}</div>
              )}
              {data.mode === 'from_lead' && data.lead && (
                <div className="opacity-70 text-xs">{data.lead.contact_name} — {data.lead.telephone}</div>
              )}
            </div>

            {isAmbiguous && ambiguousClients.length > 0 && (
              <div className="mb-3">
                <label className="text-sm font-medium block mb-1">Choisir le client</label>
                <select
                  value={form.selected_client_id || ''}
                  onChange={(e) => setForm({ ...form, selected_client_id: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm bg-transparent"
                  style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
                >
                  <option value="">— Sélectionner —</option>
                  {ambiguousClients.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom} — {c.telephone}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Nom" value={form.nom} onChange={(v) => setForm({ ...form, nom: v })} />
              <Field label="Téléphone" value={form.telephone} onChange={(v) => setForm({ ...form, telephone: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
              <Field label="Ville" value={form.ville} onChange={(v) => setForm({ ...form, ville: v })} />
              <Field label="Code postal" value={form.code_postal} onChange={(v) => setForm({ ...form, code_postal: v })} />
              <Field label="Adresse" value={form.adresse} onChange={(v) => setForm({ ...form, adresse: v })} />
              <Field label="Titre affaire" value={form.titre} onChange={(v) => setForm({ ...form, titre: v })} className="md:col-span-2" />
              <div className="md:col-span-2">
                <label className="text-sm font-medium block mb-1">Description / résumé</label>
                <textarea
                  value={form.description || ''}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm bg-transparent"
                  style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
                  rows={3}
                />
              </div>
              <Field label="Besoin (produit)" value={form.besoin} onChange={(v) => setForm({ ...form, besoin: v })} />
              <Field
                label="Montant estimé (€)"
                value={form.montant_estime ? String(form.montant_estime) : ''}
                onChange={(v) => setForm({ ...form, montant_estime: v ? Number(v) : null })}
                type="number"
              />
              <div>
                <label className="text-sm font-medium block mb-1">Commercial</label>
                <select
                  value={form.commercial_id || ''}
                  onChange={(e) => setForm({ ...form, commercial_id: e.target.value || null })}
                  className="w-full border rounded px-2 py-1 text-sm bg-transparent"
                  style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
                >
                  <option value="">— Choisir —</option>
                  {commerciaux.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Pipeline</label>
                <select
                  value={form.pipeline_stage || 'nouveau'}
                  onChange={(e) => setForm({ ...form, pipeline_stage: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm bg-transparent"
                  style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
                >
                  <option value="nouveau">Nouveau</option>
                  <option value="en_cours">En cours</option>
                  <option value="devis_envoye">Devis envoyé</option>
                  <option value="signe">Signé</option>
                  <option value="perdu">Perdu</option>
                </select>
              </div>
            </div>

            {error && (
              <div className="mt-3 p-2 rounded bg-red-600/20 text-red-400 text-sm">⚠️ {error}</div>
            )}

            <div className="flex gap-2 mt-4 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border text-sm"
                style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !form.nom || !form.titre}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
              >
                {submitting ? '⏳ Création...' : '✅ Créer affaire'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
  className?: string
  type?: string
}

function Field({ label, value, onChange, className = '', type = 'text' }: FieldProps) {
  return (
    <div className={className}>
      <label className="text-sm font-medium block mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded px-2 py-1 text-sm bg-transparent"
        style={{ borderColor: 'var(--border-default, rgba(255,255,255,0.15))' }}
      />
    </div>
  )
}
