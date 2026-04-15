'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoy\u00e9', color: 'bg-blue-100 text-blue-700' },
  lu: { label: 'Lu', color: 'bg-yellow-100 text-yellow-700' },
  signe: { label: 'Sign\u00e9', color: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refus\u00e9', color: 'bg-red-100 text-red-700' },
  expire: { label: 'Expir\u00e9', color: 'bg-gray-100 text-gray-500' },
}

interface Devis {
  id: string; reference: string; status: string; token: string
  lignes: { description: string; quantite: number; prix_unitaire: number; total: number }[]
  montant_ht: number; tva: number; montant_ttc: number; notes: string
  pdf_url: string | null; signed_pdf_url: string | null
  payment_status: string | null; acompte_pct: number
  sent_at: string | null; read_at: string | null; signed_at: string | null; created_at: string
  clients: { nom: string; telephone: string; email: string; portal_token: string }
}

interface Payment {
  id: string; montant: number; methode: string; status: string
  stripe_session_id: string | null; created_at: string; confirmed_at: string | null
}

export default function DevisDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [devis, setDevis] = useState<Devis | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [payments, setPayments] = useState<Payment[]>([])
  const [markingPaid, setMarkingPaid] = useState(false)

  useEffect(() => {
    fetch(`/api/devis?id=${id}`).then((res) => res.json()).then((data) => setDevis(Array.isArray(data) ? data[0] : data)).catch(console.error).finally(() => setLoading(false))
    fetch(`/api/devis/${id}/payment`).then((res) => res.json()).then((data) => { if (Array.isArray(data)) setPayments(data) }).catch(console.error)
  }, [id])

  const [deleting, setDeleting] = useState(false)

  async function handleMarkPaid() {
    if (!devis || !confirm('Confirmer la réception du virement ?')) return
    setMarkingPaid(true)
    try {
      const res = await fetch(`/api/devis/${devis.id}/payment`, { method: 'POST' })
      if (!res.ok) throw new Error('Erreur')
      setDevis({ ...devis, payment_status: 'paye' })
      const updatedPayments = await fetch(`/api/devis/${devis.id}/payment`).then(r => r.json())
      if (Array.isArray(updatedPayments)) setPayments(updatedPayments)
    } catch (err) { alert((err as Error).message) }
    finally { setMarkingPaid(false) }
  }

  async function handleSendSMS() {
    if (!devis) return
    setSending(true)
    try {
      const res = await fetch(`/api/devis/${devis.id}/send`, { method: 'POST' })
      if (!res.ok) throw new Error('Erreur envoi SMS')
      setDevis({ ...devis, status: 'envoye', sent_at: new Date().toISOString() })
    } catch (err) { alert((err as Error).message) }
    finally { setSending(false) }
  }

  async function handleDelete() {
    if (!devis || !confirm('Supprimer ce devis ? Cette action est irreversible.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/devis/${devis.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Erreur suppression')
      router.push('/devis')
    } catch (err) { alert((err as Error).message) }
    finally { setDeleting(false) }
  }

  if (loading) return <div className="text-gray-500">Chargement...</div>
  if (!devis) return <div className="text-red-600">Devis non trouv\u00e9</div>

  const status = STATUS_LABELS[devis.status] || STATUS_LABELS.brouillon
  const client = devis.clients
  const portalUrl = `${window.location.origin}/portail/${client?.portal_token}`

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/devis" className="text-gray-400 hover:text-gray-600">Devis</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold">{devis.reference}</h1>
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>{status.label}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">D\u00e9tail</h2>
            <table className="w-full">
              <thead><tr className="text-left text-sm text-gray-500 border-b"><th className="pb-2">Description</th><th className="pb-2 text-center">Qt\u00e9</th><th className="pb-2 text-right">P.U. HT</th><th className="pb-2 text-right">Total HT</th></tr></thead>
              <tbody>{devis.lignes.map((ligne, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-3 text-sm">{ligne.description}</td>
                  <td className="py-3 text-sm text-center">{ligne.quantite}</td>
                  <td className="py-3 text-sm text-right">{ligne.prix_unitaire.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                  <td className="py-3 text-sm text-right font-medium">{ligne.total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                </tr>
              ))}</tbody>
            </table>
            <div className="flex justify-end mt-4">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Total HT</span><span>{devis.montant_ht.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">TVA ({devis.tva}%)</span><span>{(devis.montant_ttc - devis.montant_ht).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
                <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total TTC</span><span>{devis.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Client</h2>
            <div className="space-y-2 text-sm">
              <p className="font-medium">{client?.nom}</p>
              <p className="text-gray-500 font-mono">{client?.telephone}</p>
              {client?.email && <p className="text-gray-500">{client.email}</p>}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <div className="space-y-3">
              {devis.status !== 'signe' && (
                <Link href={`/devis/${devis.id}/edit`} className="block w-full text-center bg-amber-500 text-white py-3 rounded-lg font-medium hover:bg-amber-600 transition-colors">Modifier</Link>
              )}
              {devis.status === 'brouillon' && <button onClick={handleSendSMS} disabled={sending} className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">{sending ? 'Envoi...' : 'Envoyer par SMS'}</button>}

              {/* PDF */}
              {devis.pdf_url && (
                <a href={devis.pdf_url} target="_blank" rel="noopener noreferrer" className="block w-full text-center bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors text-sm">
                  Voir le PDF original
                </a>
              )}
              {devis.status === 'signe' && devis.signed_pdf_url && (
                <a href={devis.signed_pdf_url} target="_blank" rel="noopener noreferrer" className="block w-full text-center bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors text-sm">
                  Télécharger le PDF signé
                </a>
              )}

              {/* Lien signature client */}
              {devis.token && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Lien signature client :</p>
                  <div className="flex gap-2">
                    <input type="text" value={`${window.location.origin}/d/${devis.token}`} readOnly className="flex-1 border rounded px-2 py-1 text-xs font-mono bg-gray-50" />
                    <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/d/${devis.token}`)} className="px-3 py-1 border rounded text-xs hover:bg-gray-100">Copier</button>
                  </div>
                </div>
              )}

              <div><p className="text-xs text-gray-500 mb-1">Lien portail client :</p><div className="flex gap-2"><input type="text" value={portalUrl} readOnly className="flex-1 border rounded px-2 py-1 text-xs font-mono bg-gray-50" /><button onClick={() => navigator.clipboard.writeText(portalUrl)} className="px-3 py-1 border rounded text-xs hover:bg-gray-100">Copier</button></div></div>

              {/* Paiement */}
              {devis.status === 'signe' && (
                <div className="pt-4 border-t">
                  <h3 className="text-sm font-semibold mb-2">Paiement</h3>
                  {devis.payment_status === 'paye' ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-green-700 text-sm font-medium">Payé</p>
                      {payments.filter(p => p.status === 'confirme').map(p => (
                        <p key={p.id} className="text-green-600 text-xs mt-1">
                          {p.montant.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} par {p.methode === 'stripe' ? 'carte bancaire' : 'virement'}
                          {p.confirmed_at && ` — ${new Date(p.confirmed_at).toLocaleDateString('fr-FR')}`}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <p className="text-amber-700 text-sm font-medium">En attente de paiement</p>
                        <p className="text-amber-600 text-xs mt-1">
                          {Number(devis.acompte_pct) > 0
                            ? `Acompte ${devis.acompte_pct}% : ${(devis.montant_ttc * Number(devis.acompte_pct) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`
                            : `Total : ${devis.montant_ttc.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`
                          }
                        </p>
                      </div>
                      <button
                        onClick={handleMarkPaid}
                        disabled={markingPaid}
                        className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {markingPaid ? 'Enregistrement...' : 'Marquer virement reçu'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 border-t space-y-2 text-xs text-gray-500">
                <p>Créé le {new Date(devis.created_at).toLocaleString('fr-FR')}</p>
                {devis.sent_at && <p>Envoyé le {new Date(devis.sent_at).toLocaleString('fr-FR')}</p>}
                {devis.read_at && <p>Lu le {new Date(devis.read_at).toLocaleString('fr-FR')}</p>}
                {devis.signed_at && <p>Signé le {new Date(devis.signed_at).toLocaleString('fr-FR')}</p>}
              </div>
              <div className="pt-4 border-t">
                <button onClick={handleDelete} disabled={deleting} className="w-full text-red-600 border border-red-200 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors">{deleting ? 'Suppression...' : 'Supprimer ce devis'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
