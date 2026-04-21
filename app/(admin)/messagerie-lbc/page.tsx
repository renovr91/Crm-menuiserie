'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// =============================================
// TYPES
// =============================================

type LeadStatut = 'nouveau' | 'repondu' | 'devis_envoye' | 'en_attente' | 'relance' | 'gagne' | 'perdu' | 'pas_interesse'

interface Lead {
  id: string
  conversation_id: string
  contact_name: string
  ad_id: string | null
  ad_title: string | null
  ad_price: string | null
  city: string | null
  zip_code: string | null
  departement: string | null
  statut: LeadStatut
  notes: string | null
  telephone: string | null
  dernier_message: string | null
  dernier_message_date: string | null
  dernier_message_is_me: boolean
  unread_count: number
  created_at: string
  updated_at: string
}

interface Message {
  id: string
  text: string
  createdAt: string
  isMe: boolean
  senderName: string
  attachments: { url: string; type: string; fileName?: string }[]
}

interface Template {
  id: string
  cas: string
  label: string
  contenu: string
}

interface ClassificationResult {
  cas: string
  produit?: string
  dimensions?: string
  response: string
}

// =============================================
// CONSTANTS
// =============================================

const STAGES: { code: LeadStatut; label: string; color: string }[] = [
  { code: 'nouveau',      label: 'Nouveau',       color: '#3B82F6' },
  { code: 'repondu',      label: 'Répondu',       color: '#0EA5E9' },
  { code: 'devis_envoye', label: 'Devis envoyé',  color: '#F59E0B' },
  { code: 'en_attente',   label: 'En attente',    color: '#8B5CF6' },
  { code: 'relance',      label: 'Relance',       color: '#EF4444' },
  { code: 'gagne',        label: 'Gagné',         color: '#10B981' },
  { code: 'perdu',        label: 'Perdu',         color: '#6B7280' },
]

const STATUT_CONFIG: Record<LeadStatut, { label: string; color: string; bg: string; emoji: string }> = {
  nouveau:      { label: 'Nouveau',        color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  emoji: '🆕' },
  repondu:      { label: 'Répondu',        color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)',  emoji: '💬' },
  devis_envoye: { label: 'Devis envoyé',   color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  emoji: '📋' },
  en_attente:   { label: 'En attente',     color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)',  emoji: '⏳' },
  relance:      { label: 'Relance',        color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   emoji: '🔔' },
  gagne:        { label: 'Gagné',          color: '#10B981', bg: 'rgba(16,185,129,0.12)',  emoji: '✅' },
  perdu:        { label: 'Perdu',          color: '#6B7280', bg: 'rgba(107,114,128,0.12)', emoji: '❌' },
  pas_interesse:{ label: 'Pas intéressant', color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)', emoji: '🚫' },
}

const ALL_STATUTS: LeadStatut[] = ['nouveau', 'repondu', 'devis_envoye', 'en_attente', 'relance', 'gagne', 'perdu', 'pas_interesse']

// =============================================
// SVG ICONS
// =============================================

function IconClose({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function IconChevronLeft({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function IconChevronRight({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function IconChevronDown({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// =============================================
// HELPERS
// =============================================

function timeSince(dateStr: string | null) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60000) return "À l'instant"
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  return `${Math.floor(diff / 86400000)}j`
}

function timeColor(dateStr: string | null) {
  if (!dateStr) return '#6B7280'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 3600000) return '#10B981'
  if (diff < 86400000) return '#F59E0B'
  return '#EF4444'
}

function formatFullDate(dateStr: string) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// =============================================
// LEAD CARD (Kanban)
// =============================================

function LeadCard({
  lead,
  onStageChange,
  onClick,
  isSelected,
}: {
  lead: Lead
  onStageChange: (convId: string, newStage: LeadStatut) => void
  onClick: () => void
  isSelected: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const currentIndex = STAGES.findIndex(s => s.code === lead.statut)
  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < STAGES.length - 1

  const initials = lead.contact_name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div
      className="rounded-md border cursor-pointer transition-all duration-150 relative group bg-white hover:shadow-md"
      style={{
        borderColor: isSelected ? '#0EA5E9' : '#E5E7EB',
        boxShadow: isSelected ? '0 0 0 2px rgba(14,165,233,0.2)' : undefined,
      }}
      onClick={onClick}
    >
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: '#1A3A5C' }}>
              {lead.contact_name}
            </p>
            {lead.unread_count > 0 && (
              <span className="shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1"
                style={{ backgroundColor: '#EF4444' }}>
                {lead.unread_count}
              </span>
            )}
          </div>
          <span className="text-[10px] shrink-0 font-medium ml-2" style={{ color: timeColor(lead.dernier_message_date) }}>
            {timeSince(lead.dernier_message_date)}
          </span>
        </div>

        <div className="space-y-0.5 text-[12px] text-gray-500">
          {lead.ad_title && (
            <div className="truncate">
              <a
                href={lead.ad_id ? `https://www.leboncoin.fr/bricolage/${lead.ad_id}.htm` : '#'}
                target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="hover:underline" style={{ color: '#0284C7' }}
              >
                {lead.ad_title}
              </a>
            </div>
          )}
          {lead.telephone && (
            <div><span className="text-gray-400">Tel : </span>{lead.telephone}</div>
          )}
          {(lead.city || lead.zip_code) && (
            <div><span className="text-gray-400">Lieu : </span>{lead.zip_code} {lead.city}</div>
          )}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
            style={{ background: STATUT_CONFIG[lead.statut].bg, color: STATUT_CONFIG[lead.statut].color }}>
            {initials || '?'}
          </span>
          <span className="text-[11px] truncate text-gray-500" style={{
            fontStyle: lead.dernier_message_is_me ? 'italic' : 'normal',
          }}>
            {lead.dernier_message_is_me ? 'Vous: ' : ''}{lead.dernier_message || '...'}
          </span>
        </div>
        {lead.ad_price && (
          <span className="text-[10px] font-semibold shrink-0 ml-1" style={{ color: '#16A34A' }}>{lead.ad_price}</span>
        )}
      </div>

      {/* Hover chevrons */}
      <div className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
        <button disabled={!canGoBack}
          onClick={e => { e.stopPropagation(); if (canGoBack) onStageChange(lead.conversation_id, STAGES[currentIndex - 1].code) }}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed" style={{ color: '#516F90' }}>
          <IconChevronLeft className="w-3 h-3" />
        </button>
        <div className="relative">
          <button onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
            className="p-1 rounded hover:bg-gray-100" style={{ color: '#516F90' }}>
            <IconChevronDown className="w-3 h-3" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={e => { e.stopPropagation(); setMenuOpen(false) }} />
              <div className="absolute right-0 bottom-full mb-1 z-20 bg-white rounded-md shadow-lg border border-gray-200 py-1.5 w-44">
                {ALL_STATUTS.map(s => (
                  <button key={s}
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); if (s !== lead.statut) onStageChange(lead.conversation_id, s) }}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 ${s === lead.statut ? 'font-semibold bg-gray-50' : ''}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUT_CONFIG[s].color }} />
                    {STATUT_CONFIG[s].emoji} {STATUT_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button disabled={!canGoForward}
          onClick={e => { e.stopPropagation(); if (canGoForward) onStageChange(lead.conversation_id, STAGES[currentIndex + 1].code) }}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed" style={{ color: '#516F90' }}>
          <IconChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}

// =============================================
// MAIN PAGE (messages cache + panel intégré)
// =============================================

export default function MessagerieLBCPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [counts, setCounts] = useState<Record<LeadStatut, number>>({
    nouveau: 0, repondu: 0, devis_envoye: 0, en_attente: 0, relance: 0, gagne: 0, perdu: 0, pas_interesse: 0
  })
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Messages cache : { convId → Message[] }
  const msgCacheRef = useRef<Record<string, Message[]>>({})
  const [panelMessages, setPanelMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  // Templates + classification (chargés une seule fois)
  const [templates, setTemplates] = useState<Template[]>([])
  const [classification, setClassification] = useState<ClassificationResult | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const selectedLead = useMemo(() =>
    leads.find(l => l.conversation_id === selectedConvId) || null,
    [leads, selectedConvId]
  )

  // --- Load leads from Supabase (fast, no LBC API) ---
  const loadLeads = useCallback(async (search?: string) => {
    try {
      setError(null)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/lbc-leads?${params}`)
      if (!res.ok) throw new Error('Erreur chargement leads')
      const data = await res.json()
      setLeads(data.leads || [])
      setCounts(data.counts || {})
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // --- Sync (manual only — heavy) ---
  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch('/api/lbc-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      await loadLeads(searchQuery)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }, [searchQuery, loadLeads])

  // --- Load messages (with cache) ---
  const loadMessages = useCallback(async (convId: string, contactName: string) => {
    // Check cache first
    if (msgCacheRef.current[convId]) {
      setPanelMessages(msgCacheRef.current[convId])
      return
    }

    setLoadingMessages(true)
    setPanelMessages([])
    try {
      const res = await fetch(`/api/lbc-messaging?action=messages&conv=${convId}`)
      if (!res.ok) throw new Error('Erreur')
      const data = await res.json()
      const rawMsgs = data._embedded?.messages || data.messages || []
      const msgs: Message[] = rawMsgs.map((m: any) => {
        const isMe = m.outgoing === true
        return {
          id: m.messageId || m.id,
          text: m.text || m.body || '',
          createdAt: m.createdAt || m.date || '',
          isMe,
          senderName: isMe ? 'Moi (Renov-R)' : contactName,
          attachments: (m.attachments || []).map((a: any) => ({
            url: `https://www.leboncoin.fr/messages/id/${convId}`,
            type: a.contentType || a.type || 'application/octet-stream',
            fileName: a.path ? a.path.split('/').pop() || 'fichier' : 'fichier',
          })),
        }
      })

      const sorted = msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      msgCacheRef.current[convId] = sorted
      setPanelMessages(sorted)

      // Mark as read + reset badge
      if (sorted.length > 0) {
        const lastMsg = sorted[sorted.length - 1]
        if (!lastMsg.isMe) {
          fetch('/api/lbc-messaging', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'read', conv: convId, messageId: lastMsg.id }),
          }).catch(() => {})
        }
        // Reset unread badge locally
        setLeads(prev => prev.map(l =>
          l.conversation_id === convId ? { ...l, unread_count: 0 } : l
        ))
      }
    } catch { /* ignore */ }
    finally { setLoadingMessages(false) }
  }, [])

  // --- Load templates (once) ---
  useEffect(() => {
    fetch('/api/lbc-leads?action=templates')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.templates) setTemplates(data.templates) })
      .catch(() => {})
  }, [])

  // --- Classify ---
  const classifyLastMessage = useCallback(async (adTitle: string, msgs: Message[]) => {
    const lastClientMsg = [...msgs].reverse().find(m => !m.isMe)
    if (!lastClientMsg) return
    setClassifying(true)
    try {
      const params = new URLSearchParams({ action: 'classify', titre: adTitle || '', message: lastClientMsg.text })
      const res = await fetch(`/api/lbc-leads?${params}`)
      if (res.ok) setClassification(await res.json())
    } catch { /* ignore */ }
    finally { setClassifying(false) }
  }, [])

  // --- Select a lead (open panel) ---
  const selectLead = useCallback((convId: string) => {
    setSelectedConvId(convId)
    setReplyText('')
    setClassification(null)
    setEditingNotes(false)
    const lead = leads.find(l => l.conversation_id === convId)
    if (lead) {
      setNotesText(lead.notes || '')
      loadMessages(convId, lead.contact_name)
    }
  }, [leads, loadMessages])

  // --- Classify when messages load ---
  useEffect(() => {
    if (selectedLead && panelMessages.length > 0) {
      classifyLastMessage(selectedLead.ad_title || '', panelMessages)
    }
  }, [selectedConvId, panelMessages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Scroll to bottom ---
  useEffect(() => {
    if (panelMessages.length > 0) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'instant' }), 50)
    }
  }, [panelMessages])

  // --- Focus input ---
  useEffect(() => {
    if (selectedConvId) setTimeout(() => inputRef.current?.focus(), 100)
  }, [selectedConvId])

  // --- Init ---
  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  useEffect(() => {
    loadLeads(searchQuery)
  }, [searchQuery, loadLeads])

  // --- Update status (optimistic) ---
  const updateStatus = async (convId: string, newStatut: LeadStatut) => {
    const oldLead = leads.find(l => l.conversation_id === convId)
    if (!oldLead) return

    setLeads(prev => prev.map(l =>
      l.conversation_id === convId ? { ...l, statut: newStatut } : l
    ))
    setCounts(prev => {
      const c = { ...prev }
      if (oldLead.statut in c) c[oldLead.statut]--
      if (newStatut in c) c[newStatut]++
      return c
    })

    try {
      await fetch('/api/lbc-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-status', conversationId: convId, statut: newStatut }),
      })
    } catch { /* ignore */ }
  }

  // --- Send message ---
  const handleSend = async () => {
    if (!replyText.trim() || !selectedLead || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/lbc-messaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', conv: selectedLead.conversation_id, text: replyText.trim() }),
      })
      if (!res.ok) throw new Error('Erreur envoi')
      const newMsg: Message = {
        id: crypto.randomUUID(),
        text: replyText.trim(),
        createdAt: new Date().toISOString(),
        isMe: true,
        senderName: 'Moi (Renov-R)',
        attachments: [],
      }
      const updated = [...panelMessages, newMsg]
      setPanelMessages(updated)
      msgCacheRef.current[selectedLead.conversation_id] = updated
      setReplyText('')
      inputRef.current?.focus()
      if (selectedLead.statut === 'nouveau') {
        updateStatus(selectedLead.conversation_id, 'repondu')
      }
    } catch (e: any) {
      alert('Erreur: ' + e.message)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // --- Save notes ---
  const saveNotes = async () => {
    if (!selectedLead) return
    try {
      await fetch('/api/lbc-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-notes', conversationId: selectedLead.conversation_id, notes: notesText }),
      })
      setLeads(prev => prev.map(l =>
        l.conversation_id === selectedLead.conversation_id ? { ...l, notes: notesText } : l
      ))
      setEditingNotes(false)
    } catch { /* ignore */ }
  }

  // --- Close panel ---
  const closePanel = () => {
    setSelectedConvId(null)
    setReplyText('')
    setClassification(null)
    setEditingNotes(false)
  }

  // --- Group leads by stage ---
  const byStage = useMemo(() => {
    const map: Record<string, Lead[]> = {}
    for (const s of STAGES) map[s.code] = []
    for (const lead of leads) {
      if (lead.statut === 'pas_interesse') continue
      if (map[lead.statut]) map[lead.statut].push(lead)
    }
    return map
  }, [leads])

  const totalLeads = Object.values(counts).reduce((a, b) => a + b, 0)
  const pasIntCount = counts.pas_interesse || 0

  // =============================================
  // RENDER
  // =============================================

  return (
    <div className="h-full flex flex-col -m-8 bg-gray-50/50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Messagerie LBC</h1>
          <span className="text-xs text-gray-400 font-medium">{totalLeads} leads</span>
          {pasIntCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
              {pasIntCount} archivés
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <input type="text" placeholder="Rechercher..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white text-gray-700 w-56" />
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3.5 py-2 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all text-sm font-medium">
            {syncing ? (
              <><div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />Sync...</>
            ) : '🔄 Sync LBC'}
          </button>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Chargement...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 text-sm mb-2">{error}</p>
            <button onClick={() => loadLeads()} className="text-xs text-blue-500 hover:underline">Réessayer</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-3 p-6 pt-4 min-w-max h-full">
            {STAGES.map(stage => {
              const stageLeads = byStage[stage.code] || []
              return (
                <div key={stage.code} className="w-72 flex flex-col shrink-0 rounded-md border border-gray-200 bg-gray-50/80">
                  <div className="px-3 py-2.5 border-b border-gray-200 bg-white rounded-t-md">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                      <span className="text-[13px] font-semibold text-gray-700">{stage.label}</span>
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        {stageLeads.length}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageLeads.length === 0 ? (
                      <p className="text-center text-[11px] py-8 text-gray-400">Aucun lead</p>
                    ) : (
                      stageLeads.map(lead => (
                        <LeadCard key={lead.conversation_id} lead={lead} onStageChange={updateStatus}
                          onClick={() => selectLead(lead.conversation_id)}
                          isSelected={selectedConvId === lead.conversation_id} />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ========== CONVERSATION PANEL (slide-over, stays mounted) ========== */}
      {selectedLead && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closePanel} />
          <div className="fixed inset-y-0 right-0 w-[520px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/80 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium shrink-0"
                    style={{ background: STATUT_CONFIG[selectedLead.statut].bg, color: STATUT_CONFIG[selectedLead.statut].color }}>
                    {selectedLead.contact_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">{selectedLead.contact_name}</span>
                      {selectedLead.telephone && (
                        <span className="text-[10px] px-1.5 rounded shrink-0"
                          style={{ background: 'rgba(16,185,129,0.12)', color: '#10B981' }}>
                          {selectedLead.telephone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selectedLead.ad_title && (
                        <a href={selectedLead.ad_id ? `https://www.leboncoin.fr/bricolage/${selectedLead.ad_id}.htm` : '#'}
                          target="_blank" rel="noopener noreferrer"
                          className="text-[11px] hover:underline truncate" style={{ color: '#0284C7' }}>
                          {selectedLead.ad_title}
                        </a>
                      )}
                      {selectedLead.ad_price && (
                        <span className="text-[11px] font-medium shrink-0" style={{ color: '#16A34A' }}>{selectedLead.ad_price}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href={`https://www.leboncoin.fr/messages/${selectedLead.conversation_id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="px-2 py-1.5 text-[11px] rounded-lg bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200">
                    LBC
                  </a>
                  <button onClick={closePanel} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
                    <IconClose className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Status buttons */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {ALL_STATUTS.map(s => {
                  const sc = STATUT_CONFIG[s]
                  const isActive = selectedLead.statut === s
                  return (
                    <button key={s}
                      onClick={() => {
                        if (s !== selectedLead.statut) {
                          updateStatus(selectedLead.conversation_id, s)
                          if (s === 'pas_interesse') closePanel()
                        }
                      }}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                      style={{
                        background: isActive ? sc.bg : 'transparent',
                        color: isActive ? sc.color : '#9CA3AF',
                        border: `1.5px solid ${isActive ? sc.color : '#E5E7EB'}`,
                        fontWeight: isActive ? 700 : 500,
                      }}>
                      {sc.emoji} {sc.label}
                    </button>
                  )
                })}
              </div>

              {/* Notes */}
              <div className="mt-2">
                {editingNotes ? (
                  <div className="flex gap-2">
                    <input type="text" value={notesText} onChange={e => setNotesText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveNotes()}
                      placeholder="Notes (ex: client veut 3 fenêtres...)"
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg outline-none bg-white border border-gray-200" autoFocus />
                    <button onClick={saveNotes} className="px-2 py-1 text-[10px] rounded-lg bg-emerald-500 text-white">OK</button>
                    <button onClick={() => { setEditingNotes(false); setNotesText(selectedLead.notes || '') }}
                      className="px-2 py-1 text-[10px] rounded-lg bg-gray-100 text-gray-500">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setEditingNotes(true); setNotesText(selectedLead.notes || '') }}
                    className="text-[11px] w-full text-left px-2 py-1 rounded-lg hover:bg-gray-100"
                    style={{ color: selectedLead.notes ? '#374151' : '#9CA3AF' }}>
                    {selectedLead.notes ? `📝 ${selectedLead.notes}` : '+ Ajouter une note...'}
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ background: '#FAFBFC' }}>
              {loadingMessages ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="ml-2 text-gray-400 text-sm">Chargement...</span>
                </div>
              ) : panelMessages.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">Aucun message</div>
              ) : (
                panelMessages.map((msg, i) => {
                  const showName = i === 0 || panelMessages[i - 1].isMe !== msg.isMe
                  return (
                    <div key={msg.id} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`} style={{ maxWidth: '80%' }}>
                        {showName && (
                          <div className="text-[11px] font-semibold mb-1 px-2 flex items-center gap-1.5"
                            style={{ color: msg.isMe ? '#0284C7' : '#D946EF' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: msg.isMe ? '#0284C7' : '#D946EF', display: 'inline-block' }} />
                            {msg.senderName}
                          </div>
                        )}
                        <div className="px-4 py-2.5 rounded-2xl text-sm" style={{
                          background: msg.isMe ? 'linear-gradient(135deg, #0284C7, #0EA5E9)' : '#fff',
                          color: msg.isMe ? '#fff' : '#1F2937',
                          borderBottomRightRadius: msg.isMe ? 4 : undefined,
                          borderBottomLeftRadius: !msg.isMe ? 4 : undefined,
                          border: msg.isMe ? 'none' : '1px solid #E5E7EB',
                        }}>
                          <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                          {msg.attachments.length > 0 && (
                            <div className="mt-2">
                              {msg.attachments.map((att, idx) => (
                                <a key={idx} href={att.url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium no-underline"
                                  style={{
                                    background: msg.isMe ? 'rgba(255,255,255,0.2)' : 'rgba(14,165,233,0.1)',
                                    color: msg.isMe ? '#fff' : '#0284C7',
                                  }}>
                                  {att.type === 'application/pdf' ? '📄 PDF' : att.type?.startsWith('image') ? '🖼️ Image' : '📎 Fichier'} — voir sur LBC
                                </a>
                              ))}
                            </div>
                          )}
                          <div className="text-right mt-1 text-[10px]" style={{ opacity: 0.6 }}>
                            {formatFullDate(msg.createdAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick replies */}
            {(classification || templates.length > 0) && !loadingMessages && panelMessages.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 overflow-x-auto shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] shrink-0 font-medium text-gray-400">
                    {classifying ? '⏳ Analyse...' : '💡 Réponses :'}
                  </span>
                  {classification && !classifying && (
                    <button onClick={() => setReplyText(classification.response)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0 hover:opacity-80"
                      style={{ background: 'linear-gradient(135deg, #0284C7, #0EA5E9)', color: '#fff' }}>
                      ✨ Cas {classification.cas}
                    </button>
                  )}
                  {templates.map(t => (
                    <button key={t.id} onClick={() => setReplyText(t.contenu)}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium shrink-0 hover:opacity-80 bg-gray-100 text-gray-600 border border-gray-200">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reply box */}
            <div className="px-4 py-3 border-t border-gray-200 bg-white shrink-0">
              <div className="flex items-end gap-3">
                <textarea ref={inputRef} value={replyText} onChange={e => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown} placeholder="Écrire un message..." rows={2}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none resize-none bg-gray-50 border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  style={{ maxHeight: 200, minHeight: 60 }}
                  onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px' }} />
                <button onClick={handleSend} disabled={!replyText.trim() || sending}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: replyText.trim() ? '#0EA5E9' : '#F3F4F6', color: replyText.trim() ? '#fff' : '#9CA3AF', opacity: sending ? 0.5 : 1 }}>
                  {sending ? '...' : 'Envoyer'}
                </button>
              </div>
              <div className="mt-1 text-[10px] text-gray-400">Entrée pour envoyer · Shift+Entrée pour un saut de ligne</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
