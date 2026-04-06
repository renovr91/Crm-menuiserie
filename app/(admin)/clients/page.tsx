import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase'

async function getClients() {
  const supabase = createAdminClient()
  const { data } = await supabase.from('clients').select('*, devis(id, status, montant_ttc)').order('created_at', { ascending: false })
  return data || []
}

export default async function ClientsPage() {
  let clients: Awaited<ReturnType<typeof getClients>> = []
  try { clients = await getClients() } catch { /* Supabase not configured */ }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Clients</h1>
      {clients.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Aucun client pour l&apos;instant</p>
          <p className="text-sm text-gray-400 mt-2">Les clients seront créés automatiquement lors de la création de devis</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-4 text-sm font-medium text-gray-500">Nom</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Téléphone</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Ville</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Devis</th>
                <th className="text-left p-4 text-sm font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const devisArray = client.devis as { id: string; status: string; montant_ttc: number }[] || []
                const nbDevis = devisArray.length
                const nbSignes = devisArray.filter((d) => d.status === 'signe').length
                return (
                  <tr key={client.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-4"><Link href={`/clients/${client.id}`} className="text-blue-600 hover:underline font-medium text-sm">{client.nom}</Link></td>
                    <td className="p-4 text-sm font-mono">{client.telephone || '—'}</td>
                    <td className="p-4 text-sm text-gray-500">{client.ville || '—'}</td>
                    <td className="p-4 text-sm">{nbDevis} devis {nbSignes > 0 && <span className="text-green-600">({nbSignes} signés)</span>}</td>
                    <td className="p-4 text-sm text-gray-500">{new Date(client.created_at).toLocaleDateString('fr-FR')}</td>
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
