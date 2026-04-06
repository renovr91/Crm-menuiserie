import { createAdminClient } from '@/lib/supabase'

async function getStats() {
  const supabase = createAdminClient()
  const [
    { count: totalClients },
    { count: totalDevis },
    { data: devisEnAttente },
    { data: devisSignes },
  ] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('devis').select('*', { count: 'exact', head: true }),
    supabase.from('devis').select('id').in('status', ['envoye', 'lu']),
    supabase.from('devis').select('montant_ttc').eq('status', 'signe'),
  ])
  const caSignes = devisSignes?.reduce((sum, d) => sum + (d.montant_ttc || 0), 0) || 0
  return { totalClients: totalClients || 0, totalDevis: totalDevis || 0, devisEnAttente: devisEnAttente?.length || 0, caSignes }
}

export default async function DashboardPage() {
  let stats = { totalClients: 0, totalDevis: 0, devisEnAttente: 0, caSignes: 0 }
  try { stats = await getStats() } catch { /* Supabase not configured yet */ }

  const cards = [
    { label: 'Clients', value: stats.totalClients, color: 'bg-blue-500' },
    { label: 'Devis total', value: stats.totalDevis, color: 'bg-purple-500' },
    { label: 'Devis en attente', value: stats.devisEnAttente, color: 'bg-orange-500' },
    { label: 'CA signés', value: `${stats.caSignes.toLocaleString('fr-FR')} €`, color: 'bg-green-500' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border p-6">
            <p className="text-sm text-gray-500 mb-1">{card.label}</p>
            <p className="text-3xl font-bold">{card.value}</p>
            <div className={`h-1 w-12 ${card.color} rounded mt-3`} />
          </div>
        ))}
      </div>
    </div>
  )
}
