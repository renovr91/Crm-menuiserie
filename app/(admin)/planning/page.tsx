'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────

interface Client {
  id: string
  nom: string
  telephone: string | null
  adresse: string | null
  code_postal: string | null
  ville: string | null
}

interface Commercial {
  id: string
  nom: string
  couleur: string
}

interface Pose {
  id: string
  client_id: string
  date_pose: string | null
  heure_debut: string | null
  duree_estimee: string | null
  adresse: string | null
  status: string
  notes: string | null
  commercial_id: string | null
  clients: { nom: string; telephone: string | null; adresse: string | null } | null
  commerciaux: { nom: string } | null
  commandes: { designation: string } | null
}

// ── Constants ──────────────────────────────────────────────────

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const MONTH_NAMES = [
  'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
]

const STATUS_MAP: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  planifiee: { label: 'Planifiee', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  en_cours: { label: 'En cours', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  terminee: { label: 'Terminee', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  reportee: { label: 'Reportee', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
}

// ── Helpers ─────────────────────────────────────────────────────

function getWeekDates(date: Date): Date[] {
  const d = new Date(date)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isSameDay(d1: Date, d2: Date): boolean {
  return formatDateKey(d1) === formatDateKey(d2)
}

function formatTime(t: string | null): string {
  if (!t) return ''
  const parts = t.split(':')
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`
  return t
}

function weekLabel(days: Date[]): string {
  const first = days[0]
  const last = days[6]
  const d1 = first.getDate()
  const d2 = last.getDate()
  if (first.getMonth() === last.getMonth()) {
    return `${d1} - ${d2} ${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`
  }
  return `${d1} ${MONTH_NAMES[first.getMonth()]} - ${d2} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`
}

// ── Component ───────────────────────────────────────────────────

export default function PlanningPage() {
  const router = useRouter()

  // Data
  const [poses, setPoses] = useState<Pose[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [loading, setLoading] = useState(true)

  // Week navigation
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const weekDays = useMemo(() => getWeekDates(currentDate), [currentDate])
  const today = useMemo(() => new Date(), [])

  // Filters
  const [filterCommercial, setFilterCommercial] = useState('')

  // Expanded card
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [modalDefaultDate, setModalDefaultDate] = useState('')
  const [formData, setFormData] = useState({
    client_id: '',
    date_pose: '',
    heure_debut: '',
    duree_estimee: '',
    adresse: '',
    commercial_id: '',
    notes: '',
  })

  // ── Data fetching ──

  const loadPoses = useCallback(async () => {
    try {
      const res = await fetch('/api/poses')
      if (res.ok) {
        const data = await res.json()
        setPoses(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  const loadClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients')
      if (res.ok) {
        const data = await res.json()
        setClients(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  const loadCommerciaux = useCallback(async () => {
    try {
      const res = await fetch('/api/commerciaux')
      if (res.ok) {
        const data = await res.json()
        setCommerciaux(Array.isArray(data) ? data : [])
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadPoses() }, [loadPoses])
  useEffect(() => { loadClients(); loadCommerciaux() }, [loadClients, loadCommerciaux])

  // ── Actions ──

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`/api/poses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      loadPoses()
    } catch { /* ignore */ }
  }

  async function deletePose(id: string) {
    if (!confirm('Supprimer cette pose ?')) return
    try {
      await fetch(`/api/poses/${id}`, { method: 'DELETE' })
      setExpandedId(null)
      loadPoses()
    } catch { /* ignore */ }
  }

  async function handleCreate() {
    if (!formData.client_id) return
    try {
      const res = await fetch('/api/poses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: formData.client_id,
          date_pose: formData.date_pose || null,
          heure_debut: formData.heure_debut || null,
          duree_estimee: formData.duree_estimee || null,
          adresse: formData.adresse || null,
          commercial_id: formData.commercial_id || null,
          notes: formData.notes || null,
        }),
      })
      if (res.ok) {
        setShowModal(false)
        setFormData({ client_id: '', date_pose: '', heure_debut: '', duree_estimee: '', adresse: '', commercial_id: '', notes: '' })
        loadPoses()
      }
    } catch { /* ignore */ }
  }

  function openModalForDay(dateStr: string) {
    setModalDefaultDate(dateStr)
    setFormData(prev => ({ ...prev, date_pose: dateStr }))
    setShowModal(true)
  }

  // ── Filtering & grouping ──

  const commerciauxMap = useMemo(() => {
    const map: Record<string, Commercial> = {}
    commerciaux.forEach(c => { map[c.id] = c })
    return map
  }, [commerciaux])

  const filteredPoses = useMemo(() => {
    if (!filterCommercial) return poses
    return poses.filter(p => p.commercial_id === filterCommercial)
  }, [poses, filterCommercial])

  const posesByDate = useMemo(() => {
    const map: Record<string, Pose[]> = {}
    filteredPoses.forEach(p => {
      if (!p.date_pose) return
      const key = p.date_pose.substring(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    // Sort each day by heure_debut
    Object.values(map).forEach(arr =>
      arr.sort((a, b) => (a.heure_debut || '').localeCompare(b.heure_debut || ''))
    )
    return map
  }, [filteredPoses])

  // ── Week navigation ──

  function prevWeek() {
    setCurrentDate(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() - 7)
      return d
    })
  }

  function nextWeek() {
    setCurrentDate(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + 7)
      return d
    })
  }

  function goToToday() {
    setCurrentDate(new Date())
  }

  // ── Auto-fill address from client ──

  function handleClientChange(clientId: string) {
    setFormData(prev => {
      const client = clients.find(c => c.id === clientId)
      const addr = client
        ? [client.adresse, client.code_postal, client.ville].filter(Boolean).join(', ')
        : ''
      return { ...prev, client_id: clientId, adresse: addr }
    })
  }

  // ── Pose card color ──

  function getPoseurColor(pose: Pose): string {
    if (pose.commercial_id && commerciauxMap[pose.commercial_id]) {
      return commerciauxMap[pose.commercial_id].couleur
    }
    return '#94a3b8' // gray-400 fallback
  }

  function getPoseurNom(pose: Pose): string {
    if (pose.commercial_id && commerciauxMap[pose.commercial_id]) {
      return commerciauxMap[pose.commercial_id].nom
    }
    return pose.commerciaux?.nom || '--'
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Planning des poses</h1>
        <button
          onClick={() => { setModalDefaultDate(''); setShowModal(true) }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium inline-flex items-center gap-2 self-start sm:self-auto"
        >
          <span className="text-lg leading-none">+</span>
          Nouvelle pose
        </button>
      </div>

      {/* Week nav + filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
            title="Semaine precedente"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            Aujourd&apos;hui
          </button>
          <h2 className="text-lg font-semibold text-gray-800 min-w-[240px] text-center">
            {weekLabel(weekDays)}
          </h2>
          <button
            onClick={nextWeek}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
            title="Semaine suivante"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Poseur filter */}
        <select
          value={filterCommercial}
          onChange={(e) => setFilterCommercial(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Tous les poseurs</option>
          {commerciaux.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center flex-1">
          <div className="animate-pulse flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Chargement du planning...</p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border flex-1 overflow-auto">
          {weekDays.map((day, idx) => {
            const dateKey = formatDateKey(day)
            const dayPoses = posesByDate[dateKey] || []
            const isToday = isSameDay(day, today)
            const isLast = idx === weekDays.length - 1

            return (
              <div
                key={dateKey}
                className={`
                  ${!isLast ? 'border-b border-gray-100' : ''}
                  ${isToday ? 'bg-blue-50/40' : ''}
                `}
              >
                {/* Day header */}
                <div className="flex items-center justify-between px-4 py-2.5 sm:px-6">
                  <div className="flex items-center gap-3">
                    <div
                      className={`
                        flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold
                        ${isToday ? 'bg-blue-600 text-white' : 'text-gray-700'}
                      `}
                    >
                      {day.getDate()}
                    </div>
                    <span className={`text-sm font-medium ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>
                      {DAY_NAMES[idx]}
                    </span>
                    {isToday && (
                      <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                        Aujourd&apos;hui
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => openModalForDay(dateKey)}
                    className="text-gray-400 hover:text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition-colors"
                    title={`Ajouter une pose le ${DAY_NAMES[idx]} ${day.getDate()}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                {/* Poses for this day */}
                <div className="px-4 pb-3 sm:px-6 sm:pl-[72px]">
                  {dayPoses.length === 0 ? (
                    <p className="text-sm text-gray-300 italic py-1">(Aucune pose)</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {dayPoses.map(pose => {
                        const color = getPoseurColor(pose)
                        const status = STATUS_MAP[pose.status] || STATUS_MAP.planifiee
                        const isExpanded = expandedId === pose.id
                        const address = pose.adresse || pose.clients?.adresse || ''

                        return (
                          <div
                            key={pose.id}
                            className="bg-gray-50 rounded-lg overflow-hidden transition-all duration-150 hover:shadow-sm cursor-pointer"
                            style={{ borderLeft: `4px solid ${color}` }}
                            onClick={() => setExpandedId(isExpanded ? null : pose.id)}
                          >
                            {/* Card main row */}
                            <div className="p-3">
                              <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
                                {/* Time */}
                                {pose.heure_debut && (
                                  <span className="text-sm font-mono font-semibold text-gray-500 w-14 shrink-0">
                                    {formatTime(pose.heure_debut)}
                                  </span>
                                )}

                                {/* Main info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-gray-900 truncate">
                                        {pose.clients?.nom || 'Client inconnu'}
                                        {pose.commandes?.designation && (
                                          <span className="font-normal text-gray-500">
                                            {' '}&mdash; {pose.commandes.designation}
                                          </span>
                                        )}
                                      </p>
                                      {address && (
                                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                                          <span className="inline-block mr-1">&#128205;</span>
                                          {address}
                                        </p>
                                      )}
                                    </div>

                                    {/* Status badge */}
                                    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                                      {status.label}
                                    </span>
                                  </div>

                                  {/* Poseur */}
                                  <div className="flex items-center gap-1.5 mt-1.5">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ backgroundColor: color }}
                                    />
                                    <span className="text-xs text-gray-500">
                                      {getPoseurNom(pose)}
                                    </span>
                                    {pose.duree_estimee && (
                                      <>
                                        <span className="text-gray-300 mx-1">|</span>
                                        <span className="text-xs text-gray-400">{pose.duree_estimee}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div className="border-t border-gray-100 bg-white px-3 py-3" onClick={e => e.stopPropagation()}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mb-3">
                                  <div>
                                    <span className="text-gray-400 text-xs uppercase tracking-wide">Client</span>
                                    <p className="font-medium text-gray-900">
                                      <button
                                        onClick={() => router.push(`/clients/${pose.client_id}`)}
                                        className="text-blue-600 hover:underline"
                                      >
                                        {pose.clients?.nom || '--'}
                                      </button>
                                      {pose.clients?.telephone && (
                                        <span className="text-gray-400 ml-2 font-normal">{pose.clients.telephone}</span>
                                      )}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-gray-400 text-xs uppercase tracking-wide">Adresse</span>
                                    <p className="text-gray-700">{address || '--'}</p>
                                  </div>
                                  {pose.notes && (
                                    <div className="sm:col-span-2">
                                      <span className="text-gray-400 text-xs uppercase tracking-wide">Notes</span>
                                      <p className="text-gray-700 whitespace-pre-wrap">{pose.notes}</p>
                                    </div>
                                  )}
                                </div>

                                {/* Action bar */}
                                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                                  <span className="text-xs text-gray-400 mr-1">Statut :</span>
                                  {Object.entries(STATUS_MAP).map(([key, s]) => (
                                    <button
                                      key={key}
                                      onClick={() => updateStatus(pose.id, key)}
                                      className={`
                                        inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all
                                        ${pose.status === key
                                          ? `${s.bg} ${s.text} ring-1 ring-current`
                                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                        }
                                      `}
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full ${pose.status === key ? s.dot : 'bg-gray-400'}`} />
                                      {s.label}
                                    </button>
                                  ))}

                                  <div className="flex-1" />

                                  <button
                                    onClick={() => deletePose(pose.id)}
                                    className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                                  >
                                    Supprimer
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal: Nouvelle pose ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-5">Nouvelle pose</h2>
            <div className="space-y-4">
              {/* Client */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
                <select
                  value={formData.client_id}
                  onChange={(e) => handleClientChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selectionner un client</option>
                  {clients.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.nom}{cl.telephone ? ` - ${cl.telephone}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date + Heure */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={formData.date_pose}
                    onChange={(e) => setFormData({ ...formData, date_pose: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Heure debut</label>
                  <input
                    type="time"
                    value={formData.heure_debut}
                    onChange={(e) => setFormData({ ...formData, heure_debut: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Duree */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duree estimee</label>
                <input
                  type="text"
                  value={formData.duree_estimee}
                  onChange={(e) => setFormData({ ...formData, duree_estimee: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ex: 1 journee, 3h, 2 jours..."
                />
              </div>

              {/* Adresse */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse du chantier</label>
                <input
                  type="text"
                  value={formData.adresse}
                  onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Adresse du chantier"
                />
              </div>

              {/* Poseur */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Poseur</label>
                <select
                  value={formData.commercial_id}
                  onChange={(e) => setFormData({ ...formData, commercial_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Selectionner un poseur</option>
                  {commerciaux.map((c) => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Notes complementaires..."
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={!formData.client_id}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Creer la pose
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
