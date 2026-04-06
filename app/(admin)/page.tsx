import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase'

async function getStats() {
  const supabase = createAdminClient()
  const [
    { count: totalClients },
    { count: totalDevis },
    { data: devisEnAttente },
    { data: devisSignes },
    { data: dernierDevis },
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('devis').select('*', { count: 'exact', head: true }),
    supabase.from('devis').select('id').in('status', ['envoye', 'lu']),
    supabase.from('devis').select('montant_ttc').eq('status', 'signe'),
    supabase.from('devis').select('*, clients(nom, telephone)').order('created_at', { ascending: false }).limit(5),
  ])
  const caSignes = devisSignes?.reduce((sum, d) => sum + (d.montant_ttc || 0), 0) || 0
  return {
    totalClients: totalClients || 0,
    totalDevis: totalDevis || 0,
    devisEnAttente: devisEnAttente?.length || 0,
    caSignes,
    dernierDevis: dernierDevis || [],
  }
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-gray-100 text-gray-700' },
  envoye: { label: 'Envoye', color: 'bg-blue-100 text-blue-700' },
  lu: { label: 'Lu', color: 'bg-yellow-100 text-yellow-700' },
  signe: { label: 'Signe', color: 'bg-green-100 text-green-700' },
  refuse: { label: 'Refuse', color: 'bg-red-100 text-red-700' },
  expire: { label: 'Expire', color: 'bg-gray-100 text-gray-500' },
}

export default async function DashboardPage() {
  let stats = { totalClients: 0, totalDevis: 0, devisEnAttente: 0, caSignes: 0, dernierDevis: [] as Record<string, unknown>[] }
  try { stats = await getStats() } catch { /* Supabase not configured yet */ }

  const cards = [
    { label: 'Clients', value: stats.totalClients, color: 'bg-blue-500', icon: 'C' },
    { label: 'Devis total', value: stats.totalDevis, color: 'bg-purple-500', icon: 'D' },
    { label: 'En attente', value: stats.devisEnAttente, color: 'bg-orange-500', icon: 'A' },
    { label: 'CA signes', value: `${stats.caSignes.toLocaleString('fr-FR')} \u20ac`, color: 'bg-green-500', icon: '\u20ac' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-3">
          <Link href="/clients/nouveau" className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">+ Client</Link>
          <Link href="/devis/nouveau" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">+ Devis</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{card.label}</p>
              <div className={`w-8 h-8 ${card.color} rounded-lg flex items-center justify-center text-white text-xs font-bold`}>{card.icon}</div>
            </div>
            <p className="text-2xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Derniers devis */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Derniers devis</h2>
          <Link href="/devis" className="text-blue-600 hover:text-blue-800 text-sm">Voir tout</Link>
        </div>
        {stats.dernierDevis.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Aucun devis</div>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b bg-gray-50">
              <th className="text-left p-4 text-sm font-medium text-gray-500">Reference</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Client</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Montant</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Statut</th>
              <th className="text-left p-4 text-sm font-medium text-gray-500">Date</th>
            </tr></thead>
            <tbody>
              {stats.dernierDevis.map((devis) => {
                const d = devis as Record<string, unknown>
                const client = d.clients as { nom: string; telephone: string } | null
                const status = STATUS_LABELS[(d.status as string) || 'brouillon'] || STATUS_LABELS.brouillon
                return (
                  <tr key={d.id as string} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="p-4"><Link href={`/devis/${d.id}`} className="text-blue-600 hover:underline font-mono text-sm">{d.reference as string}</Link></td>
                    <td className="p-4 text-sm font-medium">{client?.nom || '\u2014'}</td>
                    <td className="p-4 text-sm font-medium">{((d.montant_ttc as number) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                    <td className="p-4"><span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${status.color}`}>{status.label}</span></td>
                    <td className="p-4 text-sm text-gray-500">{new Date(d.created_at as string).toLocaleDateString('fr-FR')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
