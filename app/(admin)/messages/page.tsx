'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface SavedMessage {
  id: string
  titre_annonce: string
  nom_contact: string
  telephone: string | null
  message_client: string
  has_attachment: boolean
  attachments: string[] | null
  conversation_key: string
  date_email: string | null
  email_contact: string | null
  reponse_generee: string | null
  reponse_envoyee: boolean
  statut: string
  created_at: string
  nouveau_message: boolean
  devis_envoye_at: string | null
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<SavedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ imported: number; updated: number; total: number } | null>(null)
  const [selectedMsg, setSelectedMsg] = useState<SavedMessage | null>(null)
  const [filter, setFilter] = useState<'all' | 'phone' | 'nophone'>('all')
  const [replyText, setReplyText] = useState('')
  const [replyFile, setReplyFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [showReply, setShowReply] = useState(false)
  const devisFileRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // --- Data ---
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/gmail')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setMessages(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadMessages() }, [loadMessages])

  // Keep selectedMsg in sync
  useEffect(() => {
    if (selectedMsg) {
      const updated = messages.find(m => m.id === selectedMsg.id)
      if (updated) setSelectedMsg(updated)
    }
  }, [messages])

  // Auto-scroll to bottom of conversation (like WhatsApp)
  useEffect(() => {
    if (selectedMsg) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [selectedMsg])

  // Modal: lock scroll + escape key
  useEffect(() => {
    if (selectedMsg) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [selectedMsg])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // --- Actions ---
  async function changeStatut(msgId: string, newStatut: string) {
    await fetch('/api/gmail/statut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msgId, statut: newStatut }),
    })
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, statut: newStatut } : m))
  }

  async function markAsRead(msgId: string) {
    await fetch('/api/gmail/statut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msgId, nouveau_message: false }),
    })
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, nouveau_message: false } : m))
  }

  // Envoyer devis = envoie le PDF en PJ par email + marque le statut devis_envoye
  async function handleEnvoyerDevis(msg: SavedMessage, file: File) {
    if (!msg.email_contact) { alert('Pas d\'email pour ce contact'); return }
    setSending(true)
    try {
      const formData = new FormData()
      formData.append('to', msg.email_contact)
      formData.append('subject', 'Re: Nouveau message pour "' + msg.titre_annonce + '" sur leboncoin')
      formData.append('message', `Bonjour,\n\nVeuillez trouver ci-joint notre devis concernant votre demande.\n\nN'hesitez pas a nous contacter pour toute question.\n\nCordialement,\nRENOV-R 91`)
      formData.append('messageId', msg.id)
      formData.append('file', file)
      const res = await fetch('/api/gmail/reply', { method: 'POST', body: formData })
      if (res.ok) {
        // Marquer comme devis envoye
        const now = new Date().toISOString()
        await fetch('/api/gmail/statut', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: msg.id, statut: 'devis_envoye', devis_envoye_at: now }),
        })
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, statut: 'devis_envoye', devis_envoye_at: now } : m))
        setSelectedMsg(prev => prev ? { ...prev, statut: 'devis_envoye', devis_envoye_at: now } : null)
        loadMessages()
      } else {
        const data = await res.json()
        alert('Erreur envoi: ' + (data.error || 'Echec'))
      }
    } catch { alert('Erreur connexion') }
    finally { setSending(false) }
  }

  function openModal(msg: SavedMessage) {
    setSelectedMsg(msg)
    setShowReply(false)
    setReplyText('')
    setReplyFile(null)
    if (msg.nouveau_message) markAsRead(msg.id)
  }

  function closeModal() {
    setSelectedMsg(null)
    setShowReply(false)
    setReplyText('')
    setReplyFile(null)
  }

  const AUTO_REPLY = `Bonjour, merci pour votre message !\nN'hesitez pas a nous envoyer vos dimensions, coloris et toute information utile concernant votre projet, nous le traiterons au plus vite.\nMerci de nous laisser votre numero de telephone afin que nous puissions vous recontacter si besoin de precisions.\nBonne journee !`

  async function handleAutoReply(msg: SavedMessage) {
    if (!msg.email_contact) return
    setSending(true)
    try {
      const formData = new FormData()
      formData.append('to', msg.email_contact)
      formData.append('subject', 'Re: Nouveau message pour "' + msg.titre_annonce + '" sur leboncoin')
      formData.append('message', AUTO_REPLY)
      formData.append('messageId', msg.id)
      const res = await fetch('/api/gmail/reply', { method: 'POST', body: formData })
      if (res.ok) {
        changeStatut(msg.id, 'en_cours')
        loadMessages()
      } else alert('Erreur envoi')
    } catch { alert('Erreur connexion') }
    finally { setSending(false) }
  }

  async function handleReply(msg: SavedMessage) {
    if (!replyText.trim() || !msg.email_contact) return
    setSending(true)
    try {
      const formData = new FormData()
      formData.append('to', msg.email_contact)
      formData.append('subject', 'Re: Nouveau message pour "' + msg.titre_annonce + '" sur leboncoin')
      formData.append('message', replyText)
      formData.append('messageId', msg.id)
      if (replyFile) formData.append('file', replyFile)
      const res = await fetch('/api/gmail/reply', { method: 'POST', body: formData })
      if (res.ok) {
        setReplyText('')
        setReplyFile(null)
        setShowReply(false)
        loadMessages()
      } else {
        const data = await res.json()
        alert('Erreur: ' + (data.error || 'Envoi echoue'))
      }
    } catch { alert('Erreur connexion') }
    finally { setSending(false) }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      if (!res.ok) throw new Error('Erreur sync')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSyncResult({ imported: data.imported, updated: data.updated, total: data.total })
      await loadMessages()
    } catch (err) { alert((err as Error).message) }
    finally { setSyncing(false) }
  }

  // --- Date helper (UTC-safe, no hydration mismatch server/client) ---
  const MOIS = ['jan', 'fev', 'mar', 'avr', 'mai', 'jun', 'jul', 'aou', 'sep', 'oct', 'nov', 'dec']
  const formatDate = (d: string) => {
    const date = new Date(d)
    return `${date.getUTCDate()} ${MOIS[date.getUTCMonth()]}`
  }
  const formatDateFull = (d: string) => {
    const date = new Date(d)
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`
  }

  // --- Text helpers ---
  const cleanLbc = (t: string) => t
    .replace(/\(https?:\/\/[^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\(\s*$/gm, '')
    .replace(/^\s*\(\s*$/gm, '')
    .replace(/Bonjour SENROLL,?\s*/gi, '')
    .replace(/Vous avez un nouveau message\.?\s*/gi, '')
    .replace(/Répondre dans la messagerie\s*/gi, '')
    .replace(/Messages pr[ée]c[ée]dents\s*/gi, '')
    .replace(/Retrouvez tous vos contacts[^\n]*/gi, '')
    .replace(/Voir tous mes contacts\s*/gi, '')
    .replace(/Merci de votre confiance[^\n]*/gi, '')
    .replace(/L'équipe leboncoin\s*/gi, '')
    .replace(/Si vous ne souhaitez plus[^\n]*/gi, '')
    .replace(/Accès à nos conditions[^\n]*/gi, '')
    .replace(/cliquez\s*ici\.?\s*/gi, '')
    .replace(/Lien\s*:\s*/gi, '')
    .replace(/Nom\s*:\s*/gi, '')
    .replace(/leboncoin\s*$/gm, '')
    .replace(/-{3,}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const parseConversation = (text: string) => {
    const msgs: { author: string; date: string; content: string }[] = []

    // Parse LeBonCoin email format: latest message between « » + "Messages précédents" section
    const currentMatch = text.match(/nouveau message\.\s*\n\s*(?:Nom\s*:\s*)?(.+?)\s*\n[\s\S]*?[«]\s*([\s\S]*?)\s*[»]/)
    if (currentMatch) {
      msgs.push({ author: currentMatch[1].trim(), date: 'Dernier message', content: cleanLbc(currentMatch[2]) })
    }
    const prevSection = text.split(/Messages pr[ée]c[ée]dents/i)[1]
    if (prevSection) {
      const parts = prevSection.split(/\n(.+)\n(\d{1,2}\s+\w+\.?\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?)\s*\n/)
      for (let i = 1; i + 2 < parts.length; i += 3) {
        const author = parts[i].trim()
        const date = parts[i + 1].trim()
        let content = cleanLbc(parts[i + 2])
        content = content.replace(/\n[A-ZÀ-Ü][\w\s\-éèêëàâôùûîïç]+\n\d+\s*€\s*$/m, '').trim()
        if (!author || author.toLowerCase() === 'leboncoin') continue
        if (!content || content.length < 2) continue
        msgs.push({ author, date: date.replace(/:\d{2}$/, ''), content })
      }
    }
    // Reverse: LBC puts newest first, we want oldest first (chronological)
    return msgs.reverse()
  }

  function buildTimeline(msg: SavedMessage) {
    const timeline: { type: 'client' | 'senroll' | 'pj'; author: string; date: string; content: string; pjUrl?: string; sortKey: number }[] = []
    const parsed = parseConversation(msg.message_client || '')

    // Collect SENROLL content already visible in parsed conversation (for dedup)
    const parsedSenrollTexts = parsed
      .filter(m => m.author === 'SENROLL')
      .map(m => m.content.substring(0, 50).toLowerCase().trim())

    parsed.forEach((m, i) => {
      timeline.push({ type: m.author === 'SENROLL' ? 'senroll' : 'client', author: m.author, date: m.date, content: m.content, sortKey: i })
    })

    const replyPjUrls = new Set((msg.reponse_generee || '').match(/\[PJ\]\s*(https?:\/\/\S+)/g)?.map(m => m.replace('[PJ] ', '')) || [])
    const hasRealPJ = msg.attachments && msg.attachments.length > 0
    if (hasRealPJ) {
      msg.attachments!.filter(url => !replyPjUrls.has(url)).forEach((url, i) => {
        timeline.push({ type: 'pj', author: msg.nom_contact, date: '', content: '', pjUrl: url, sortKey: parsed.length > 0 ? 0.5 + i * 0.01 : i })
      })
    } else if ((msg.message_client || '').includes('pièce jointe')) {
      const rawText = msg.message_client || ''
      const lbcLink = rawText.match(/\(https:\/\/www\.leboncoin\.fr\/messages\/id\/[^\s)]+\)/)
      const url = lbcLink ? lbcLink[0].replace(/[()]/g, '') : 'https://www.leboncoin.fr/messages'
      timeline.push({ type: 'pj', author: msg.nom_contact, date: '', content: '', pjUrl: url, sortKey: parsed.length > 0 ? 0.5 : 0 })
    }

    // Add replies — dedup by CONTENT (not by count)
    if (msg.reponse_generee) {
      const allReplies = msg.reponse_generee.split('\n---\n')
      let addedCount = 0
      allReplies.forEach((reply) => {
        const pjMatch = reply.match(/\[PJ\]\s*(https?:\/\/\S+)/)
        let textOnly = reply.replace(/\n\[PJ\]\s*https?:\/\/\S+/, '').trim()
        // Strip date prefix like "[8 avr., 07:36] SENROLL: "
        textOnly = textOnly.replace(/^\[.*?\]\s*SENROLL\s*:\s*/i, '').trim()
        if (!textOnly) return
        // Check if this reply content already exists in the parsed conversation
        const replyStart = textOnly.substring(0, 50).toLowerCase().trim()
        const alreadyVisible = parsedSenrollTexts.some(t => t === replyStart || replyStart.includes(t) || t.includes(replyStart))
        if (alreadyVisible) return
        // Place after all parsed messages
        timeline.push({ type: 'senroll', author: 'SENROLL', date: '', content: textOnly, pjUrl: pjMatch?.[1], sortKey: parsed.length + addedCount + 0.5 })
        addedCount++
      })
    }

    if (parsed.length === 0 && !msg.reponse_generee) {
      timeline.push({ type: 'client', author: msg.nom_contact, date: '', content: cleanLbc(msg.message_client || ''), sortKey: 0 })
    } else if (parsed.length === 0) {
      timeline.unshift({ type: 'client', author: msg.nom_contact, date: '', content: cleanLbc(msg.message_client || '').substring(0, 300), sortKey: -1 })
    }
    return timeline.sort((a, b) => a.sortKey - b.sortKey)
  }

  // --- Computed ---
  const visibleMessages = messages.filter(m => m.statut !== 'archive')
  const filtered = visibleMessages.filter(m => {
    if (filter === 'phone' && !m.telephone) return false
    if (filter === 'nophone' && m.telephone) return false
    return true
  })
  const nbWithPhone = visibleMessages.filter(m => m.telephone).length
  const nbArchive = messages.filter(m => m.statut === 'archive').length
  const nbNewMessages = visibleMessages.filter(m => m.nouveau_message).length

  const statutLabels: Record<string, string> = {
    nouveau: 'Nouveau',
    en_cours: 'En cours',
    devis_envoye: 'Devis envoye',
    devis_accepte: 'Devis accepte',
  }

  const columns = [
    { key: 'nouveau', label: 'Nouveau', gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', countBg: 'bg-amber-500', items: filtered.filter(m => m.statut === 'nouveau' || !m.statut) },
    { key: 'en_cours', label: 'En cours', gradient: 'from-blue-500 to-indigo-500', bg: 'bg-blue-50', countBg: 'bg-blue-500', items: filtered.filter(m => m.statut === 'en_cours') },
    { key: 'devis_envoye', label: 'Devis envoye', gradient: 'from-purple-500 to-violet-500', bg: 'bg-purple-50', countBg: 'bg-purple-500', items: filtered.filter(m => m.statut === 'devis_envoye' || m.statut === 'traite') },
    { key: 'devis_accepte', label: 'Devis accepte', gradient: 'from-emerald-500 to-green-500', bg: 'bg-emerald-50', countBg: 'bg-emerald-500', items: filtered.filter(m => m.statut === 'devis_accepte') },
  ]

  // --- Render ---
  return (
    <div className="w-full max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Messagerie</h1>
            <p className="text-gray-400 text-sm mt-1">
              {visibleMessages.length} conversations
              {nbArchive > 0 && <span> · {nbArchive} archivees</span>}
              {nbNewMessages > 0 && (
                <span className="ml-2 inline-flex items-center gap-1.5 text-red-600 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-dot" />
                  {nbNewMessages} nouveau{nbNewMessages > 1 ? 'x' : ''} message{nbNewMessages > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="inline-flex items-center gap-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-2xl font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all text-sm shadow-lg shadow-blue-500/20">
            <span className={`text-lg ${syncing ? 'animate-spin' : ''}`}>↻</span>
            {syncing ? 'Synchronisation...' : 'Synchroniser Gmail'}
          </button>
        </div>

        {syncResult && (
          <div className="mt-3 inline-flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl animate-slide-up">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {syncResult.imported} nouveau(x), {syncResult.updated} mis a jour
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-8">
        {[
          { key: 'all' as const, label: `Tous (${visibleMessages.length})` },
          { key: 'phone' as const, label: `Avec tel. (${nbWithPhone})` },
          { key: 'nophone' as const, label: `Sans tel. (${visibleMessages.length - nbWithPhone})` },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-5 py-2.5 rounded-2xl text-xs font-semibold transition-all duration-200
              ${filter === f.key
                ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/20'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Kanban */}
      {loading ? (
        <div className="grid grid-cols-4 gap-5">
          {[0, 1, 2].map(col => (
            <div key={col}>
              <div className="h-24 bg-gray-100 rounded-2xl mb-4 animate-pulse" />
              {[0, 1, 2].map(i => (
                <div key={i} className="h-28 bg-gray-100 rounded-2xl mb-3 animate-pulse" style={{ opacity: 1 - i * 0.25 }} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-5">
          {columns.map(col => {
            const colNewCount = col.items.filter(m => m.nouveau_message).length
            return (
              <div key={col.key} className="min-h-[400px]">
                {/* Column header */}
                <div className={`${col.bg} rounded-2xl p-4 mb-4 border border-white/60`}>
                  <div className={`h-1 w-12 rounded-full bg-gradient-to-r ${col.gradient} mb-3`} />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-gray-800">{col.label}</span>
                      <span className={`${col.countBg} text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full min-w-[26px] text-center`}>
                        {col.items.length}
                      </span>
                    </div>
                    {colNewCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-dot" />
                        {colNewCount} new
                      </span>
                    )}
                  </div>
                </div>

                {/* Cards */}
                <div className="space-y-3">
                  {col.items.map((msg, idx) => {
                    const isNew = msg.nouveau_message
                    return (
                      <div key={msg.id} onClick={() => openModal(msg)}
                        className={`relative bg-white rounded-2xl cursor-pointer transition-all duration-200 hover:-translate-y-0.5 animate-slide-up
                          ${isNew
                            ? 'animate-pulse-glow border-2 border-red-300 ring-1 ring-red-200/50 hover:shadow-xl'
                            : 'border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200'}`}
                        style={{ animationDelay: `${idx * 40}ms` }}>

                        {/* NEW MESSAGE banner */}
                        {isNew && (
                          <div className="bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-t-2xl flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse-dot" />
                            Nouveau message !
                          </div>
                        )}

                        <div className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Avatar */}
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0
                                ${isNew
                                  ? 'bg-gradient-to-br from-red-500 to-orange-500 shadow-lg shadow-red-500/30'
                                  : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                                {(msg.nom_contact || '?')[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className={`text-sm font-semibold truncate ${isNew ? 'text-red-700' : 'text-gray-900'}`}>
                                  {msg.nom_contact || 'Inconnu'}
                                </p>
                                <p className="text-xs text-gray-600 font-medium truncate">{msg.titre_annonce}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-gray-400">
                                {formatDate(msg.date_email || msg.created_at)}
                              </span>
                              {isNew && (
                                <span className="bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-pulse-dot shadow-lg shadow-red-500/40">
                                  !
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Tags */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-3 pl-[52px]">
                            {msg.telephone && (
                              <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg font-medium border border-emerald-100">
                                {msg.telephone}
                              </span>
                            )}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <span className="text-[11px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-lg font-medium border border-violet-100">
                                {msg.attachments.length} PJ
                              </span>
                            )}
                            {msg.reponse_envoyee && (
                              <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-lg font-medium border border-blue-100">
                                Repondu
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ========== MODAL ========== */}
      {selectedMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />

          {/* Modal */}
          <div className="relative w-full max-w-4xl h-[85vh] bg-white rounded-3xl shadow-2xl overflow-hidden animate-modal-in flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-lg font-bold text-white shadow-lg shadow-blue-500/25 shrink-0">
                  {(selectedMsg.nom_contact || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 truncate">{selectedMsg.nom_contact || 'Inconnu'}</h2>
                  <p className="text-sm text-gray-500 truncate">{selectedMsg.titre_annonce}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {selectedMsg.telephone && (
                  <a href={`tel:${selectedMsg.telephone}`}
                    className="inline-flex items-center gap-1.5 text-sm bg-emerald-50 text-emerald-700 px-4 py-2 rounded-xl font-semibold border border-emerald-200 hover:bg-emerald-100 transition-colors">
                    {selectedMsg.telephone}
                  </a>
                )}
                {selectedMsg.email_contact && (
                  <span className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-xl border border-gray-100 max-w-[200px] truncate">
                    {selectedMsg.email_contact}
                  </span>
                )}
                <button onClick={closeModal}
                  className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors text-xl">
                  ×
                </button>
              </div>
            </div>

            {/* Conversation area */}
            <div className="flex-1 overflow-y-auto px-8 py-6 bg-gradient-to-b from-gray-50/80 to-white">
              <div className="max-w-2xl mx-auto space-y-4">
                {buildTimeline(selectedMsg).map((item, i) => {
                  if (item.type === 'pj') {
                    const isLbc = item.pjUrl?.includes('leboncoin.fr')
                    const isImage = item.pjUrl?.match(/\.(jpg|jpeg|png|gif|webp)/i) || item.pjUrl?.startsWith('data:image/')
                    return (
                      <div key={`pj-${i}`} className="flex justify-start">
                        <div className="bg-violet-50 border border-violet-100 rounded-2xl rounded-tl-md px-4 py-3 max-w-sm shadow-sm">
                          {isLbc ? (
                            <a href={item.pjUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 text-xs text-violet-700 font-semibold hover:text-violet-900">
                              Voir la PJ sur LeBonCoin ↗
                            </a>
                          ) : isImage ? (
                            <a href={item.pjUrl} target="_blank" rel="noopener noreferrer">
                              <img src={item.pjUrl} alt="PJ" className="rounded-xl max-h-48 object-cover hover:opacity-90 transition-opacity" />
                            </a>
                          ) : (
                            <a href={item.pjUrl} target="_blank" rel="noopener noreferrer"
                              className="text-violet-600 underline text-xs font-medium">Voir la piece jointe</a>
                          )}
                        </div>
                      </div>
                    )
                  }

                  const isOurs = item.type === 'senroll'
                  return (
                    <div key={i} className={`flex ${isOurs ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-5 py-3.5 shadow-sm
                        ${isOurs
                          ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-br-md'
                          : 'bg-white border border-gray-100 text-gray-800 rounded-bl-md'}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-xs font-bold ${isOurs ? 'text-blue-100' : 'text-gray-500'}`}>
                            {item.author}
                          </span>
                          {item.date && (
                            <span className={`text-[10px] ${isOurs ? 'text-blue-200' : 'text-gray-400'}`}>
                              {item.date}
                            </span>
                          )}
                        </div>
                        <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isOurs ? 'text-white/95' : 'text-gray-700'}`}>
                          {item.content}
                        </p>
                        {item.pjUrl && (
                          <a href={item.pjUrl} target="_blank" rel="noopener noreferrer" className="block mt-2">
                            {(item.pjUrl.match(/\.(jpg|jpeg|png|gif|webp)/i) || item.pjUrl.startsWith('data:image/'))
                              ? <img src={item.pjUrl} alt="PJ" className="rounded-xl max-h-40 object-cover hover:opacity-90 transition-opacity" />
                              : <span className={`text-xs underline ${isOurs ? 'text-blue-200' : 'text-blue-500'}`}>Voir la piece jointe</span>}
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div ref={chatEndRef} />
              </div>
            </div>

            {/* Bottom bar: status + reply */}
            <div className="border-t border-gray-100 bg-white">
              {/* Status row */}
              <div className="flex items-center gap-2 px-8 py-3 border-b border-gray-50">
                <span className="text-xs text-gray-400 mr-1 font-medium">Statut :</span>
                {['nouveau', 'en_cours', 'devis_envoye', 'devis_accepte'].map(s => {
                  const colors: Record<string, { active: string; inactive: string }> = {
                    nouveau: { active: 'bg-amber-500 text-white shadow-md shadow-amber-500/25', inactive: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200' },
                    en_cours: { active: 'bg-blue-500 text-white shadow-md shadow-blue-500/25', inactive: 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200' },
                    devis_envoye: { active: 'bg-purple-500 text-white shadow-md shadow-purple-500/25', inactive: 'bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200' },
                    devis_accepte: { active: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25', inactive: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200' },
                  }
                  const isActive = selectedMsg.statut === s || (s === 'devis_envoye' && selectedMsg.statut === 'traite')
                  return (
                    <button key={s} onClick={() => {
                      changeStatut(selectedMsg.id, s)
                      setSelectedMsg(prev => prev ? { ...prev, statut: s } : null)
                    }}
                      className={`text-xs px-4 py-1.5 rounded-full font-semibold transition-all duration-200
                        ${isActive ? colors[s].active : colors[s].inactive}`}>
                      {statutLabels[s]}
                    </button>
                  )
                })}
                <button onClick={() => { if (confirm('Archiver cette conversation ?')) { changeStatut(selectedMsg.id, 'archive'); closeModal() } }}
                  className="text-xs px-4 py-1.5 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 font-medium ml-auto transition-colors border border-red-100">
                  Archiver
                </button>
              </div>

              {/* Reply area */}
              {selectedMsg.email_contact && (
                <div className="px-8 py-4">
                  {!showReply ? (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setShowReply(true)}
                        className="flex-1 text-left px-5 py-3 bg-gray-50 rounded-2xl text-sm text-gray-400 hover:bg-gray-100 transition-colors border border-gray-100">
                        Ecrire une reponse...
                      </button>
                      <button onClick={() => devisFileRef.current?.click()} disabled={sending || !!selectedMsg.devis_envoye_at}
                        className={`text-xs px-5 py-3 rounded-2xl font-bold transition-all shadow-lg ${
                          selectedMsg.devis_envoye_at
                            ? 'bg-violet-100 text-violet-500 border border-violet-200 shadow-none cursor-default'
                            : 'bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 shadow-violet-500/20'
                        }`}>
                        {sending ? 'Envoi...' : selectedMsg.devis_envoye_at ? `Devis envoye le ${formatDateFull(selectedMsg.devis_envoye_at)}` : 'Envoyer devis'}
                      </button>
                      <input ref={devisFileRef} type="file" accept=".pdf,image/*" className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f && selectedMsg) handleEnvoyerDevis(selectedMsg, f)
                          e.target.value = ''
                        }} />
                      <button onClick={() => handleAutoReply(selectedMsg)} disabled={sending}
                        className="text-xs px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-400 text-white font-bold hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 transition-all shadow-lg shadow-amber-500/20">
                        {sending ? '...' : 'Reponse auto'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 animate-slide-up">
                      <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                        placeholder="Votre reponse..."
                        rows={3} autoFocus
                        className="w-full border border-gray-200 rounded-2xl px-5 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none bg-gray-50 focus:bg-white transition-colors" />
                      {replyFile && (
                        <div className="flex items-center gap-2 text-xs text-violet-600 bg-violet-50 px-3 py-1.5 rounded-xl border border-violet-100">
                          <span>{replyFile.name}</span>
                          <button onClick={() => setReplyFile(null)} className="text-red-400 hover:text-red-600">&times;</button>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleReply(selectedMsg)} disabled={sending || !replyText.trim()}
                          className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-2xl text-sm font-bold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-40 transition-all shadow-lg shadow-blue-500/20">
                          {sending ? 'Envoi...' : 'Envoyer'}
                        </button>
                        <label className="text-xs px-4 py-2.5 rounded-2xl cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition-colors">
                          + PJ
                          <input type="file" accept="image/*,.pdf" className="hidden"
                            onChange={e => { setReplyFile(e.target.files?.[0] || null); e.target.value = '' }} />
                        </label>
                        <button onClick={() => devisFileRef.current?.click()} disabled={sending || !!selectedMsg.devis_envoye_at}
                          className={`text-xs px-4 py-2.5 rounded-2xl font-semibold transition-all ${
                            selectedMsg.devis_envoye_at
                              ? 'bg-violet-50 text-violet-400 border border-violet-200 cursor-default'
                              : 'bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 shadow-md shadow-violet-500/20'
                          }`}>
                          {sending ? 'Envoi...' : selectedMsg.devis_envoye_at ? 'Devis envoye' : 'Envoyer devis'}
                        </button>
                        <button onClick={() => handleAutoReply(selectedMsg)} disabled={sending}
                          className="text-xs px-4 py-2.5 rounded-2xl bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold border border-amber-200 disabled:opacity-50 transition-colors">
                          Reponse auto
                        </button>
                        <button onClick={() => { setShowReply(false); setReplyText(''); setReplyFile(null) }}
                          className="text-gray-400 px-4 py-2.5 rounded-2xl text-xs hover:bg-gray-100 transition-colors ml-auto">
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
