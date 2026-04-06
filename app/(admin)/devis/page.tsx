import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoyé', color: 'bg-blue-100 text-blue-700' },
  lu: { label: 'Lu', color: 'bg-yellow-100 text-yellow-700' },
  signe: { label: 'Signé', color: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refusé', color: 'bg-red-100 text-red-700' },
  expire: { label: 'Expiré', color: 'bg-gray-100 text-gray-500' },
}

async function getDevis() {
  const supabase = createAdminClient()
  const { data } = await supabase.from('devis').select('*, clients(nom, telephone)').order('created_at', { ascending: false })
  return data || []
}

export default async function DevisListPage() {
  let devisList: Awaited<ReturnType<typeof getDevis>> = []
  try { devisList = await getDevis() } catch { /* Supabase not configured */ }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Devis</h1>
        <Link href="/devis/nouveau" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">+ Nouveau devis</Link>
      </div>
      {devisList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 mb-4">Aucun devis pour l&apos;instant</p>
          <Link href="/devis/nouveau" className="text-blue-600 hover:underline text-sm">Créer votre premier devis</Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b bg-gray-50">
              <th className="text-left p-4 text-sm font-medium text-gray-500">Référence</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Client</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Montant TTC</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Statut</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Date</th>
            </tr></thead>
            <tbody>
              {devisList.map((devis) => {
                const status = STATUS_LABELS[devis.status] || STATUS_LABELS.brouillon
                const client = devis.clients as { nom: string; telephone: string } | null
                return (
                  <tr key={devis.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-4"><Link href={`/devis/${devis.id}`} className="text-blue-600 hover:underline font-mono text-sm">{devis.reference}</Link></td>
                    <td className="p-4"><p className="font-medium text-sm">{client?.nom || '—'}</p><p className="text-gray-500 text-xs">{client?.telephone || ''}</p></td>
                    <td className="p-4 font-medium text-sm">{devis.montant_ttc?.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) || '—'}</td>
                    <td className="p-4"><span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span></td>
                    <td className="p-4 text-sm text-gray-500">{new Date(devis.created_at).toLocaleDateString('fr-FR')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
