'use client'

import { useState, useEffect, useCallback } from 'react'

interface Activity {
  id: string
  action_type: string
  entity_type: string | null
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
  commerciaux: { nom: string; couleur: string } | null
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  lead_status_change: { label: 'Changement statut lead', icon: '🔄', color: '#f59e0b' },
  lead_note_update: { label: 'Note sur lead', icon: '📝', color: '#8b5cf6' },
  message_sent: { label: 'Message envoyé', icon: '💬', color: '#3b82f6' },
  message_read: { label: 'Message lu', icon: '👁️', color: '#6b7280' },
  client_create: { label: 'Nouveau client', icon: '👤', color: '#10b981' },
  client_update: { label: 'Client modifié', icon: '✏️', color: '#06b6d4' },
  affaire_create: { label: 'Nouvelle affaire', icon: '🆕', color: '#10b981' },
  affaire_update: { label: 'Affaire modifiée', icon: '✏️', color: '#06b6d4' },
  affaire_stage_change: { label: 'Déplacement pipeline', icon: '📊', color: '#f59e0b' },
  devis_create: { label: 'Nouveau devis', icon: '📄', color: '#10b981' },
  devis_update: { label: 'Devis modifié', icon: '✏️', color: '#06b6d4' },
  tache_create: { label: 'Nouvelle tâche', icon: '✅', color: '#10b981' },
  tache_done: { label: 'Tâche terminée', icon: '✔️', color: '#22c55e' },
  tache_update: { label: 'Tâche modifiée', icon: '✏️', color: '#06b6d4' },
  login: { label: 'Connexion', icon: '🔑', color: '#6b7280' },
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return "À l'instant"
  if (mins < 60) return `Il y a ${mins} min`
  if (hours < 24) return `Il y a ${hours}h`
  if (days < 7) return `Il y a ${days}j`
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function getDetailText(a: Activity): string {
  const d = a.details
  const parts: string[] = []

  if (d.titre) parts.push(`"${d.titre}"`)
  if (d.statut) parts.push(`→ ${d.statut}`)
  if (d.pipeline_stage) parts.push(`→ ${d.pipeline_stage}`)
  if (d.contact_name) parts.push(`(${d.contact_name})`)
  if (d.text_preview) parts.push(`"${d.text_preview}"`)

  return parts.join(' ')
}

export default function ActivitePage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/activity?limit=100')
      if (res.ok) {
        const data = await res.json()
        setActivities(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  const filtered = filter === 'all'
    ? activities
    : activities.filter(a => {
        if (filter === 'leads') return a.entity_type === 'lead_lbc' || a.entity_type === 'message_lbc'
        if (filter === 'affaires') return a.entity_type === 'affaire'
        if (filter === 'taches') return a.entity_type === 'tache'
        if (filter === 'clients') return a.entity_type === 'client'
        return true
      })

  // Group by date
  const groups: Record<string, Activity[]> = {}
  for (const a of filtered) {
    const day = new Date(a.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    if (!groups[day]) groups[day] = []
    groups[day].push(a)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Fil d&apos;activité</h1>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Rafraîchir</button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          { key: 'all', label: 'Tout' },
          { key: 'leads', label: 'Leads LBC' },
          { key: 'affaires', label: 'Affaires' },
          { key: 'taches', label: 'Tâches' },
          { key: 'clients', label: 'Clients' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white border text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Chargement...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Aucune activité enregistrée</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([day, items]) => (
            <div key={day}>
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">{day}</h2>
              <div className="bg-white rounded-xl shadow-sm border divide-y">
                {items.map(a => {
                  const info = ACTION_LABELS[a.action_type] || { label: a.action_type, icon: '❓', color: '#6b7280' }
                  const commercialName = a.commerciaux?.nom || 'Système'
                  const commercialColor = a.commerciaux?.couleur || '#6b7280'
                  const detail = getDetailText(a)

                  return (
                    <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                      {/* Icon */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 mt-0.5"
                        style={{ background: `${info.color}15`, color: info.color }}
                      >
                        {info.icon}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-xs font-bold px-1.5 py-0.5 rounded"
                            style={{ background: `${commercialColor}20`, color: commercialColor }}
                          >
                            {commercialName}
                          </span>
                          <span className="text-sm text-gray-900">{info.label}</span>
                        </div>
                        {detail && (
                          <p className="text-sm text-gray-500 mt-0.5 truncate">{detail}</p>
                        )}
                      </div>

                      {/* Time */}
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-1">
                        {formatTime(a.created_at)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
