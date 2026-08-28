'use client'

import { useState, useEffect, useCallback } from 'react'

interface Reponse {
  id: number
  telephone: string
  message: string
  tag: string | null
  recu_le: string
}

interface SmsLigne {
  id: string
  telephone: string
  message: string
  envoye_par: string | null
  client_nom: string | null
  statut: string
  erreur: string | null
  created_at: string
}

// 1 SMS = 160 car. (GSM-7) ; au-delà, segments de 153 car.
function segments(texte: string): number {
  const n = texte.length
  if (n === 0) return 0
  if (n <= 160) return 1
  return Math.ceil(n / 153)
}

export default function SmsPage() {
  const [telephone, setTelephone] = useState('')
  const [clientNom, setClientNom] = useState('')
  const [message, setMessage] = useState('')
  const [envoyePar, setEnvoyePar] = useState('')
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null)
  const [historique, setHistorique] = useState<SmsLigne[]>([])
  const [reponses, setReponses] = useState<Reponse[]>([])

  useEffect(() => {
    try { setEnvoyePar(localStorage.getItem('sms_envoye_par') || '') } catch {}
  }, [])

  const chargerHistorique = useCallback(async () => {
    try {
      const r = await fetch('/api/sms', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setHistorique(j.sms || [])
    } catch {}
  }, [])

  // Relève les réponses clients chez OVH à l'ouverture de la page
  const chargerReponses = useCallback(async () => {
    try {
      const r = await fetch('/api/sms/reponses', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setReponses(j.reponses || [])
    } catch {}
  }, [])

  useEffect(() => { chargerHistorique(); chargerReponses() }, [chargerHistorique, chargerReponses])

  async function envoyer() {
    setRetour(null)
    setEnvoiEnCours(true)
    try {
      const r = await fetch('/api/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telephone, message, client_nom: clientNom || null, envoye_par: envoyePar || null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'échec de l’envoi')
      setRetour({ ok: true, texte: '✅ SMS envoyé' })
      setMessage('')
      chargerHistorique()
    } catch (e) {
      setRetour({ ok: false, texte: e instanceof Error ? e.message : 'erreur inconnue' })
    } finally {
      setEnvoiEnCours(false)
    }
  }

  const nbSeg = segments(message)

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">✉️ SMS clients</h1>
        <p className="text-sm text-gray-500 mt-1">
          Envoi via OVH — le client voit un <b>numéro court partagé</b> et peut <b>répondre directement</b> :
          ses réponses remontent ici. (Le sender ID « RENOVR91 » a été refusé par OVH faute de Kbis + pièce
          d’identité — tant qu’il n’est pas validé, c’est ce mode qui s’applique.)
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-8">
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Numéro mobile *</label>
            <input value={telephone} onChange={(e) => setTelephone(e.target.value)}
              placeholder="06 12 34 56 78" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Client (facultatif, pour l’historique)</label>
            <input value={clientNom} onChange={(e) => setClientNom(e.target.value)}
              placeholder="Mme Dupont" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Envoyé par</label>
            <input value={envoyePar}
              onChange={(e) => { setEnvoyePar(e.target.value); try { localStorage.setItem('sms_envoye_par', e.target.value) } catch {} }}
              placeholder="Yacine / Assistante…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <label className="block text-xs text-gray-500 mb-1">Message *</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
          placeholder="Bonjour, votre devis Renov-R est prêt…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <div className="flex items-center justify-between mt-3">
          <div className={`text-xs ${nbSeg > 3 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
            {message.length} caractères — {nbSeg} SMS facturé{nbSeg > 1 ? 's' : ''}
          </div>
          <button onClick={envoyer} disabled={envoiEnCours || !telephone || !message}
            className="px-5 py-2 rounded-lg bg-gray-900 text-white text-sm disabled:opacity-40">
            {envoiEnCours ? '⏳ Envoi…' : '📤 Envoyer le SMS'}
          </button>
        </div>
        {retour && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-lg ${retour.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {retour.texte}
          </div>
        )}
      </div>

      {reponses.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-600 mb-2">💬 Réponses des clients</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {reponses.map((r) => (
              <div key={r.id} className="px-4 py-3 flex gap-4">
                <div className="text-xs text-gray-400 whitespace-nowrap w-24">
                  {new Date(r.recu_le).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-900">{r.message}</div>
                  <a href={`tel:${r.telephone}`} className="text-xs text-blue-600 hover:underline">{r.telephone}</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium text-gray-600 mb-2">Derniers envois</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Quand</th>
              <th className="text-left px-4 py-2.5 font-medium">À</th>
              <th className="text-left px-4 py-2.5 font-medium">Message</th>
              <th className="text-left px-4 py-2.5 font-medium">Par</th>
              <th className="text-left px-4 py-2.5 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {historique.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun SMS envoyé pour l’instant</td></tr>
            )}
            {historique.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                  {new Date(s.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <div className="text-gray-900">{s.client_nom || '—'}</div>
                  <div className="text-xs text-gray-500">{s.telephone}</div>
                </td>
                <td className="px-4 py-2.5 text-gray-700 max-w-[380px]"><div className="line-clamp-2" title={s.message}>{s.message}</div></td>
                <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{s.envoye_par || '—'}</td>
                <td className="px-4 py-2.5">
                  {s.statut === 'envoye'
                    ? <span className="text-emerald-600 text-xs font-medium">✅ envoyé</span>
                    : <span className="text-red-600 text-xs font-medium" title={s.erreur || ''}>❌ erreur</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
