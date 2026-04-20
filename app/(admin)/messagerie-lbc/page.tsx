'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

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

const MY_USER_ID = '45b4d579-2ede-4a25-b889-280ffd926393'

const STATUT_CONFIG: Record<LeadStatut, { label: string; color: string; bg: string; emoji: string }> = {
  nouveau:      { label: 'Nouveau',       color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  emoji: '🆕' },
  repondu:      { label: 'Répondu',       color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)',  emoji: '💬' },
  devis_envoye: { label: 'Devis envoyé',  color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  emoji: '📋' },
  en_attente:   { label: 'En attente',    color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)',  emoji: '⏳' },
  relance:      { label: 'Relance',       color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   emoji: '🔔' },
  gagne:        { label: 'Gagné',         color: '#10B981', bg: 'rgba(16,185,129,0.12)',  emoji: '✅' },
  perdu:        { label: 'Perdu',         color: '#6B7280', bg: 'rgba(107,114,128,0.12)', emoji: '❌' },
  pas_interesse:{ label: 'Pas intéressant',color: '#9CA3AF', bg: 'rgba(156,163,175,0.10)', emoji: '🚫' },
}

const ALL_STATUTS: LeadStatut[] = ['nouveau', 'repondu', 'devis_envoye', 'en_attente', 'relance', 'gagne', 'perdu', 'pas_interesse']

// =============================================
// MAIN COMPONENT
// =============================================

export default function MessagerieLBCPage() {
  // --- State ---
  const [leads, setLeads] = useState<Lead[]>([])
  const [counts, setCounts] = useState<Record<LeadStatut, number>>({
    nouveau: 0, repondu: 0, devis_envoye: 0, en_attente: 0, relance: 0, gagne: 0, perdu: 0, pas_interesse: 0
  })
  const [activeStatut, setActiveStatut] = useState<LeadStatut | null>(null)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [classification, setClassification] = useState<ClassificationResult | null>(null)

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // --- Load leads from Supabase ---
  const loadLeads = useCallback(async (statut?: LeadStatut | null, search?: string) => {
    try {
      setError(null)
      const params = new URLSearchParams()
      if (statut) params.set('statut', statut)
      if (search) params.set('search', search)
      const res = await fetch(`/api/lbc-leads?${params}`)
      if (!res.ok) throw new Error('Erreur chargement leads')
      const data = await res.json()
      // Masquer "pas intéressant" par défaut (sauf si on filtre explicitement dessus)
      const allLeads = data.leads || []
      setLeads(statut === 'pas_interesse' ? allLeads : allLeads.filter((l: Lead) => l.statut !== 'pas_interesse'))
      setCounts(data.counts || {})
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // --- Sync LBC → Supabase ---
  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/lbc-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      if (!res.ok) throw new Error('Erreur sync')
      await loadLeads(activeStatut, searchQuery)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }, [activeStatut, searchQuery, loadLeads])

  // --- Load templates ---
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/lbc-leads?action=templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.templates || [])
      }
    } catch { /* ignore */ }
  }, [])

  // --- Load messages for a conversation ---
  const loadMessages = useCallback(async (convId: string, contactName: string) => {
    try {
      setLoadingMessages(true)
      const res = await fetch(`/api/lbc-messaging?action=messages&conv=${convId}`)
      if (!res.ok) throw new Error('Erreur chargement messages')
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

      setMessages(msgs.reverse())

      // Marquer comme lu
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1]
        if (!lastMsg.isMe) {
          fetch('/api/lbc-messaging', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'read', conv: convId, messageId: lastMsg.id }),
          }).catch(() => {})
        }
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  // --- Classify last client message ---
  const classifyLastMessage = useCallback(async (lead: Lead, msgs: Message[]) => {
    // Trouver le dernier message du client (pas le nôtre)
    const lastClientMsg = [...msgs].reverse().find(m => !m.isMe)
    if (!lastClientMsg) return

    setClassifying(true)
    try {
      const params = new URLSearchParams({
        action: 'classify',
        titre: lead.ad_title || '',
        message: lastClientMsg.text,
      })
      const res = await fetch(`/api/lbc-leads?${params}`)
      if (res.ok) {
        const data = await res.json()
        setClassification(data)
      }
    } catch { /* ignore */ }
    finally { setClassifying(false) }
  }, [])

  // --- Update lead status ---
  const updateStatus = async (convId: string, newStatut: LeadStatut) => {
    try {
      await fetch('/api/lbc-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-status', conversationId: convId, statut: newStatut }),
      })
      // Mettre à jour localement
      setLeads(prev => prev.map(l =>
        l.conversation_id === convId ? { ...l, statut: newStatut } : l
      ))
      if (selectedLead?.conversation_id === convId) {
        setSelectedLead(prev => prev ? { ...prev, statut: newStatut } : null)
      }
      // Recharger les compteurs
      loadLeads(activeStatut, searchQuery)
    } catch { /* ignore */ }
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
      setSelectedLead(prev => prev ? { ...prev, notes: notesText } : null)
      setLeads(prev => prev.map(l =>
        l.conversation_id === selectedLead.conversation_id ? { ...l, notes: notesText } : l
      ))
      setEditingNotes(false)
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

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        text: replyText.trim(),
        createdAt: new Date().toISOString(),
        isMe: true,
        senderName: 'Moi (Renov-R)',
        attachments: [],
      }])
      setReplyText('')
      inputRef.current?.focus()

      // Auto-avancement : nouveau → répondu
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // --- Select a lead ---
  const selectLead = (lead: Lead) => {
    setSelectedLead(lead)
    setReplyText('')
    setClassification(null)
    setEditingNotes(false)
    setNotesText(lead.notes || '')
    loadMessages(lead.conversation_id, lead.contact_name)
  }

  // --- Effects ---
  useEffect(() => {
    loadLeads()
    loadTemplates()
    // Auto-sync au chargement
    handleSync()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadLeads(activeStatut, searchQuery)
  }, [activeStatut, searchQuery, loadLeads])

  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [messages])

  useEffect(() => {
    if (selectedLead) inputRef.current?.focus()
  }, [selectedLead])

  // Classify quand les messages sont chargés
  useEffect(() => {
    if (selectedLead && messages.length > 0) {
      classifyLastMessage(selectedLead, messages)
    }
  }, [selectedLead?.conversation_id, messages.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Helpers ---
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return "À l'instant"
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`
    if (diff < 86400000) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    if (diff < 604800000) return d.toLocaleDateString('fr-FR', { weekday: 'short' })
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  }

  const formatFullDate = (dateStr: string) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const timeSinceColor = (dateStr: string | null) => {
    if (!dateStr) return '#6B7280'
    const diff = Date.now() - new Date(dateStr).getTime()
    if (diff < 3600000) return '#10B981' // < 1h = vert
    if (diff < 86400000) return '#F59E0B' // < 24h = orange
    return '#EF4444' // > 24h = rouge
  }

  const totalLeads = Object.values(counts).reduce((a, b) => a + b, 0)

  // =============================================
  // RENDER
  // =============================================

  return (
    <div className="h-full flex" style={{ background: 'var(--bg-primary)' }}>

      {/* ========== LEFT PANEL ========== */}
      <div className="w-[400px] shrink-0 flex flex-col border-r" style={{ borderColor: 'var(--border-default)' }}>

        {/* Header */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Messagerie LBC
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                {totalLeads} leads
              </span>
            </h1>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{
                background: syncing ? 'rgba(14,165,233,0.15)' : 'var(--bg-tertiary)',
                color: syncing ? '#0EA5E9' : 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              {syncing ? '⏳ Sync...' : '🔄 Sync LBC'}
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Rechercher nom, ville, CP, téléphone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none mb-3"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          />

          {/* Status tabs */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveStatut(null)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
              style={{
                background: activeStatut === null ? 'rgba(14,165,233,0.15)' : 'transparent',
                color: activeStatut === null ? '#0EA5E9' : 'var(--text-tertiary)',
                border: `1px solid ${activeStatut === null ? '#0EA5E9' : 'var(--border-default)'}`,
              }}
            >
              Tous ({totalLeads})
            </button>
            {ALL_STATUTS.map(s => {
              const cfg = STATUT_CONFIG[s]
              const count = counts[s] || 0
              if (count === 0 && s !== 'nouveau') return null
              return (
                <button
                  key={s}
                  onClick={() => setActiveStatut(activeStatut === s ? null : s)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                  style={{
                    background: activeStatut === s ? cfg.bg : 'transparent',
                    color: activeStatut === s ? cfg.color : 'var(--text-tertiary)',
                    border: `1px solid ${activeStatut === s ? cfg.color : 'var(--border-default)'}`,
                  }}
                >
                  {cfg.emoji} {cfg.label} ({count})
                </button>
              )
            })}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>Chargement...</div>
          ) : error ? (
            <div className="p-4 text-center">
              <p className="text-red-400 text-sm mb-2">{error}</p>
              <button onClick={() => loadLeads(activeStatut)} className="text-xs text-cyan-400 hover:underline">Réessayer</button>
            </div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
              {activeStatut ? `Aucun lead "${STATUT_CONFIG[activeStatut].label}"` : 'Aucun lead — cliquez Sync LBC'}
            </div>
          ) : (
            leads.map(lead => {
              const cfg = STATUT_CONFIG[lead.statut]
              const isSelected = selectedLead?.conversation_id === lead.conversation_id
              return (
                <button
                  key={lead.conversation_id}
                  onClick={() => selectLead(lead)}
                  className="w-full text-left px-4 py-3 border-b transition-colors"
                  style={{
                    borderColor: 'var(--border-default)',
                    background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar + status dot */}
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
                        style={{ background: cfg.bg, color: cfg.color }}>
                        {lead.contact_name?.[0]?.toUpperCase() || '?'}
                      </div>
                      {/* Time indicator dot */}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                        style={{
                          background: timeSinceColor(lead.dernier_message_date),
                          borderColor: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                        }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Name + date */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {lead.contact_name}
                        </span>
                        <span className="text-[10px] shrink-0 ml-2" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(lead.dernier_message_date)}
                        </span>
                      </div>

                      {/* Status badge + city + phone */}
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                        {(lead.city || lead.zip_code) && (
                          <span className="text-[10px] px-1.5 rounded" style={{
                            background: 'rgba(168, 85, 247, 0.12)',
                            color: '#9333EA',
                          }}>
                            {lead.zip_code || ''} {lead.city || ''}
                          </span>
                        )}
                        {lead.telephone && (
                          <span className="text-[10px] px-1.5 rounded" style={{
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#10B981',
                          }}>
                            📞 {lead.telephone}
                          </span>
                        )}
                      </div>

                      {/* Ad title */}
                      {lead.ad_title && (
                        <div className="text-[11px] truncate mt-0.5" style={{ color: '#0284C7' }}>
                          {lead.ad_title}
                        </div>
                      )}

                      {/* Last message preview */}
                      <div className="text-xs truncate mt-0.5" style={{
                        color: lead.dernier_message_is_me ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                        fontStyle: lead.dernier_message_is_me ? 'italic' : 'normal',
                      }}>
                        {lead.dernier_message_is_me ? 'Vous: ' : ''}{lead.dernier_message || '...'}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ========== RIGHT PANEL ========== */}
      <div className="flex-1 flex flex-col">
        {!selectedLead ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
            <div className="text-center">
              <div className="text-4xl mb-4">💬</div>
              <p>Sélectionnez une conversation</p>
              <p className="text-xs mt-2">Cliquez sur "Sync LBC" pour charger les conversations</p>
            </div>
          </div>
        ) : (
          <>
            {/* ===== LEAD INFO HEADER ===== */}
            <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium"
                    style={{ background: STATUT_CONFIG[selectedLead.statut].bg, color: STATUT_CONFIG[selectedLead.statut].color }}>
                    {selectedLead.contact_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {selectedLead.contact_name}
                      </span>
                      {(selectedLead.city || selectedLead.zip_code) && (
                        <span className="text-[10px] px-1.5 rounded" style={{
                          background: 'rgba(168, 85, 247, 0.12)', color: '#9333EA',
                        }}>
                          📍 {selectedLead.zip_code} {selectedLead.city}
                        </span>
                      )}
                      {selectedLead.telephone && (
                        <span className="text-[10px] px-1.5 rounded" style={{
                          background: 'rgba(16, 185, 129, 0.12)', color: '#10B981',
                        }}>
                          📞 {selectedLead.telephone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selectedLead.ad_title && (
                        <span className="text-[11px]" style={{ color: '#0284C7' }}>{selectedLead.ad_title}</span>
                      )}
                      {selectedLead.ad_price && (
                        <span className="text-[11px] font-medium" style={{ color: '#16A34A' }}>{selectedLead.ad_price}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status selector */}
                  <select
                    value={selectedLead.statut}
                    onChange={e => updateStatus(selectedLead.conversation_id, e.target.value as LeadStatut)}
                    className="text-xs px-2 py-1.5 rounded-lg outline-none cursor-pointer"
                    style={{
                      background: STATUT_CONFIG[selectedLead.statut].bg,
                      color: STATUT_CONFIG[selectedLead.statut].color,
                      border: `1px solid ${STATUT_CONFIG[selectedLead.statut].color}`,
                      fontWeight: 600,
                    }}
                  >
                    {ALL_STATUTS.map(s => (
                      <option key={s} value={s}>{STATUT_CONFIG[s].emoji} {STATUT_CONFIG[s].label}</option>
                    ))}
                  </select>

                  <a href={`https://www.leboncoin.fr/messages/${selectedLead.conversation_id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="px-2.5 py-1.5 text-[11px] rounded-lg"
                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                    Voir sur LBC
                  </a>
                  {selectedLead.statut !== 'pas_interesse' && (
                    <button
                      onClick={() => { updateStatus(selectedLead.conversation_id, 'pas_interesse'); setSelectedLead(null) }}
                      className="px-2.5 py-1.5 text-[11px] rounded-lg"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                      🚫 Pas intéressant
                    </button>
                  )}
                </div>
              </div>

              {/* Notes section */}
              <div className="mt-2">
                {editingNotes ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={notesText}
                      onChange={e => setNotesText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveNotes()}
                      placeholder="Notes (ex: client veut 3 fenêtres, rappeler lundi...)"
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg outline-none"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                      autoFocus
                    />
                    <button onClick={saveNotes} className="px-2 py-1 text-[10px] rounded-lg"
                      style={{ background: '#10B981', color: '#fff' }}>OK</button>
                    <button onClick={() => { setEditingNotes(false); setNotesText(selectedLead.notes || '') }}
                      className="px-2 py-1 text-[10px] rounded-lg"
                      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingNotes(true); setNotesText(selectedLead.notes || '') }}
                    className="text-[11px] w-full text-left px-2 py-1 rounded-lg transition-colors"
                    style={{
                      color: selectedLead.notes ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                      background: 'transparent',
                    }}
                  >
                    {selectedLead.notes ? `📝 ${selectedLead.notes}` : '+ Ajouter une note...'}
                  </button>
                )}
              </div>
            </div>

            {/* ===== MESSAGES ===== */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {loadingMessages ? (
                <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Chargement des messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Aucun message</div>
              ) : (
                messages.map((msg, i) => {
                  const showName = i === 0 || messages[i - 1].isMe !== msg.isMe
                  return (
                    <div key={msg.id} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`} style={{ maxWidth: '75%' }}>
                        {showName && (
                          <div className="text-[11px] font-semibold mb-1 px-2 flex items-center gap-1.5" style={{
                            color: msg.isMe ? '#0284C7' : '#D946EF',
                          }}>
                            <span style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              background: msg.isMe ? '#0284C7' : '#D946EF',
                              display: 'inline-block',
                            }} />
                            {msg.senderName}
                          </div>
                        )}
                        <div className="px-4 py-2.5 rounded-2xl text-sm" style={{
                          background: msg.isMe ? 'linear-gradient(135deg, #0284C7, #0EA5E9)' : 'var(--bg-tertiary)',
                          color: msg.isMe ? '#fff' : 'var(--text-primary)',
                          borderBottomRightRadius: msg.isMe ? '4px' : undefined,
                          borderBottomLeftRadius: !msg.isMe ? '4px' : undefined,
                          border: msg.isMe ? 'none' : '2px solid var(--border-default)',
                        }}>
                          <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                          {msg.attachments.length > 0 && (
                            <div className="mt-2">
                              {msg.attachments.map((att, idx) => (
                                <a key={idx} href={att.url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium no-underline"
                                  style={{
                                    background: msg.isMe ? 'rgba(255,255,255,0.2)' : 'rgba(14, 165, 233, 0.1)',
                                    color: msg.isMe ? '#fff' : '#0284C7',
                                    border: msg.isMe ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(14, 165, 233, 0.3)',
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

            {/* ===== QUICK REPLIES (Templates) ===== */}
            {(classification || templates.length > 0) && !loadingMessages && messages.length > 0 && (
              <div className="px-5 py-2 border-t overflow-x-auto" style={{ borderColor: 'var(--border-default)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] shrink-0 font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    {classifying ? '⏳ Analyse...' : '💡 Réponses rapides :'}
                  </span>

                  {/* Classification suggestion (priorité) */}
                  {classification && !classifying && (
                    <button
                      onClick={() => setReplyText(classification.response)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium shrink-0 transition-all hover:opacity-80"
                      style={{
                        background: 'linear-gradient(135deg, #0284C7, #0EA5E9)',
                        color: '#fff',
                      }}
                    >
                      ✨ Cas {classification.cas} — {classification.cas === 'A' ? 'Demander infos' :
                        classification.cas === 'B' ? 'Demander dimensions' :
                        classification.cas === 'C' ? 'Demander tel' :
                        classification.cas === 'D' ? 'Confirmer devis' :
                        classification.cas === 'H' ? 'Refus tel' : 'Notification'}
                    </button>
                  )}

                  {/* Templates manuels */}
                  {templates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setReplyText(t.contenu)}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium shrink-0 transition-all hover:opacity-80"
                      style={{
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-default)',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ===== REPLY BOX ===== */}
            <div className="px-5 py-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex items-end gap-3">
                <textarea
                  ref={inputRef}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Écrire un message..."
                  rows={3}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none resize-none"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    maxHeight: '300px',
                    minHeight: '80px',
                  }}
                  onInput={e => {
                    const target = e.target as HTMLTextAreaElement
                    target.style.height = 'auto'
                    target.style.height = Math.min(target.scrollHeight, 300) + 'px'
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!replyText.trim() || sending}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{
                    background: replyText.trim() ? '#0EA5E9' : 'var(--bg-tertiary)',
                    color: replyText.trim() ? '#fff' : 'var(--text-tertiary)',
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  {sending ? '...' : 'Envoyer'}
                </button>
              </div>
              <div className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                Entrée pour envoyer · Shift+Entrée pour un saut de ligne
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
