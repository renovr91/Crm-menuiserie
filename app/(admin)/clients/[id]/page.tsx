'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoye', color: 'bg-blue-100 text-blue-700' },
  lu: { label: 'Lu', color: 'bg-yellow-100 text-yellow-700' },
  signe: { label: 'Signe', color: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refuse', color: 'bg-red-100 text-red-700' },
  expire: { label: 'Expire', color: 'bg-gray-100 text-gray-500' },
}

interface ClientDetail {
  id: string; nom: string; telephone: string; email: string
  adresse: string; code_postal: string; ville: string
  notes: string; portal_token: string; created_at: string
  devis: { id: string; reference: string; status: string; montant_ht: number; montant_ttc: number; created_at: string }[]
}

export default function ClientDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then((res) => res.json())
      .then(setClient)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!client || !confirm('Supprimer ce client et tous ses devis ? Cette action est irreversible.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Erreur suppression')
      router.push('/clients')
    } catch (err) { alert((err as Error).message) }
    finally { setDeleting(false) }
  }

  if (loading) return <div className="text-gray-500">Chargement...</div>
  if (!client) return <div className="text-red-600">Client non trouve</div>

  const devisArray = client.devis || []
  const totalCA = devisArray.filter(d => d.status === 'signe').reduce((sum, d) => sum + (d.montant_ttc || 0), 0)

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/clients" className="text-gray-400 hover:text-gray-600">Clients</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold">{client.nom}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Devis du client */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Devis ({devisArray.length})</h2>
              <Link href={`/devis/nouveau?client=${client.id}`} className="text-blue-600 hover:text-blue-800 text-sm font-medium">+ Nouveau devis</Link>
            </div>
            {devisArray.length === 0 ? (
              <p className="text-gray-400 text-sm">Aucun devis pour ce client</p>
            ) : (
              <table className="w-full">
                <thead><tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-2">Reference</th>
                  <th className="pb-2 text-right">Montant TTC</th>
                  <th className="pb-2 text-center">Statut</th>
                  <th className="pb-2 text-right">Date</th>
                </tr></thead>
                <tbody>
                  {devisArray.map((d) => {
                    const status = STATUS_LABELS[d.status] || STATUS_LABELS.brouillon
                    return (
                      <tr key={d.id} className="border-b last:border-0">
                        <td className="py-3"><Link href={`/devis/${d.id}`} className="text-blue-600 hover:underline font-mono text-sm">{d.reference}</Link></td>
                        <td className="py-3 text-sm text-right font-medium">{d.montant_ttc?.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                        <td className="py-3 text-center"><span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span></td>
                        <td className="py-3 text-sm text-right text-gray-500">{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Sidebar info client */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Coordonnees</h2>
            <div className="space-y-3 text-sm">
              {client.telephone && <div><p className="text-gray-500 text-xs">Telephone</p><p className="font-mono">{client.telephone}</p></div>}
              {client.email && <div><p className="text-gray-500 text-xs">Email</p><p>{client.email}</p></div>}
              {(client.adresse || client.ville) && <div><p className="text-gray-500 text-xs">Adresse</p><p>{[client.adresse, client.code_postal, client.ville].filter(Boolean).join(', ')}</p></div>}
              {client.notes && <div><p className="text-gray-500 text-xs">Notes</p><p className="text-gray-600">{client.notes}</p></div>}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Resume</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Devis</span><span className="font-medium">{devisArray.length}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Signes</span><span className="font-medium text-green-600">{devisArray.filter(d => d.status === 'signe').length}</span></div>
              <div className="flex justify-between border-t pt-2"><span className="text-gray-500">CA total</span><span className="font-bold">{totalCA.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span></div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <div className="space-y-3">
              <Link href={`/devis/nouveau?client=${client.id}`} className="block w-full text-center bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">Creer un devis</Link>
              <p className="text-xs text-gray-500">Cree le {new Date(client.created_at).toLocaleDateString('fr-FR')}</p>
              <div className="pt-3 border-t">
                <button onClick={handleDelete} disabled={deleting} className="w-full text-red-600 border border-red-200 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors">{deleting ? 'Suppression...' : 'Supprimer ce client'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
