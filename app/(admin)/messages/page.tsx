'use client'

import { useState, useEffect } from 'react'

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
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<SavedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ imported: number; updated: number; total: number } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'phone' | 'nophone'>('all')
  const [statutFilter, setStatutFilter] = useState<'all' | 'nouveau' | 'en_cours' | 'traite'>('all')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyFile, setReplyFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)

  async function changeStatut(msgId: string, newStatut: string) {
    await fetch('/api/gmail/statut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: msgId, statut: newStatut }),
    })
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, statut: newStatut } : m))
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
        setReplyTo(null)
        loadMessages()
      } else {
        const data = await res.json()
        alert('Erreur: ' + (data.error || 'Envoi echoue'))
      }
    } catch { alert('Erreur connexion') }
    finally { setSending(false) }
  }

  async function loadMessages() {
    try {
      const res = await fetch('/api/gmail')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data)) setMessages(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadMessages() }, [])

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
      // Reload messages from DB
      await loadMessages()
    } catch (err) { alert((err as Error).message) }
    finally { setSyncing(false) }
  }

  const visibleMessages = messages.filter(m => m.statut !== 'archive')
  const filtered = visibleMessages.filter(m => {
    if (filter === 'phone' && !m.telephone) return false
    if (filter === 'nophone' && m.telephone) return false
    return true
  })

  const nbWithPhone = messages.filter(m => m.telephone).length
  const nbNouveau = messages.filter(m => m.statut === 'nouveau').length
  const nbEnCours = messages.filter(m => m.statut === 'en_cours').length
  const nbTraite = messages.filter(m => m.statut === 'traite').length
  const nbArchive = messages.filter(m => m.statut === 'archive').length

  // Clean LeBonCoin junk from text
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

    // Extract the latest message (between « »)
    const currentMatch = text.match(/nouveau message\.\s*\n\s*(?:Nom\s*:\s*)?(.+?)\s*\n[\s\S]*?[«]\s*([\s\S]*?)\s*[»]/)
    if (currentMatch) {
      msgs.push({ author: currentMatch[1].trim(), date: 'Dernier message', content: cleanLbc(currentMatch[2]) })
    }

    // Parse "Messages précédents"
    const prevSection = text.split(/Messages pr[ée]c[ée]dents/i)[1]
    if (prevSection) {
      const parts = prevSection.split(/\n(.+)\n(\d{1,2}\s+\w+\.?\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?)\s*\n/)
      for (let i = 1; i + 2 < parts.length; i += 3) {
        const author = parts[i].trim()
        const date = parts[i + 1].trim()
        let content = cleanLbc(parts[i + 2])
        content = content.replace(/\n[A-ZÀ-Ü][\w\s\-éèêëàâôùûîïç]+\n\d+\s*€\s*$/m, '').trim()

        if (!author || author.toLowerCase() === 'leboncoin') continue
        if (!content || content.length < 3) continue

        msgs.push({ author, date: date.replace(/:\d{2}$/, ''), content })
      }
    }

    return msgs
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Messages LeBonCoin</h1>
        <span className="text-sm text-gray-400">{visibleMessages.length} conversations{nbArchive > 0 ? ` (${nbArchive} archives)` : ''}</span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
        >
          {syncing ? 'Mise a jour...' : 'Mettre a jour depuis Gmail'}
        </button>
        {syncResult && (
          <span className="text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded-lg">
            {syncResult.imported} nouveau(x), {syncResult.updated} mis a jour — {syncResult.total} total
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-1 bg-white border rounded-lg p-1 mb-4 w-fit">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${filter === 'all' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
          Tous ({messages.length})
        </button>
        <button onClick={() => setFilter('phone')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${filter === 'phone' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
          Avec telephone ({nbWithPhone})
        </button>
        <button onClick={() => setFilter('nophone')} className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${filter === 'nophone' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
          Sans telephone ({messages.length - nbWithPhone})
        </button>
      </div>

      {/* Kanban columns */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 text-sm">Chargement...</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {[
            { key: 'nouveau', label: 'Nouveau', color: 'bg-orange-500', items: filtered.filter(m => m.statut === 'nouveau' || !m.statut) },
            { key: 'en_cours', label: 'En cours', color: 'bg-blue-500', items: filtered.filter(m => m.statut === 'en_cours') },
            { key: 'traite', label: 'Traite', color: 'bg-green-500', items: filtered.filter(m => m.statut === 'traite') },
          ].map(col => (
            <div key={col.key} className="min-h-[300px]">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <span className="text-sm font-semibold text-gray-700">{col.label}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.map(msg => (
                  <div key={msg.id} className={`bg-white rounded-lg shadow-sm border overflow-hidden transition-shadow ${expanded === msg.id ? 'shadow-md ring-2 ring-blue-200' : 'hover:shadow-md'}`}>
                    {/* Card header */}
                    <div className="p-3 cursor-pointer" onClick={() => setExpanded(expanded === msg.id ? null : msg.id)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-sm truncate">{msg.nom_contact || 'Inconnu'}</span>
                        <span className="text-xs text-gray-400">{new Date(msg.date_email || msg.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{msg.titre_annonce}</p>
                      <div className="flex items-center gap-1.5 mt-2">
                        {msg.telephone && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{msg.telephone}</span>}
                        {msg.has_attachment && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">PJ</span>}
                        {msg.reponse_envoyee && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Repondu</span>}
                      </div>
                    </div>

                    {/* Expanded: unified timeline */}
                    {expanded === msg.id && (
                      <div>
                        <div className="border-t px-3 py-2 bg-gray-50 space-y-1.5 max-h-80 overflow-y-auto">
                          {(() => {
                            // Build unified timeline: parsed messages + sent replies
                            const timeline: { type: 'client' | 'senroll' | 'pj'; author: string; date: string; content: string; pjUrl?: string; sortKey: number }[] = []

                            // 1. Add parsed conversation messages
                            const parsed = parseConversation(msg.message_client || '')
                            parsed.forEach((m, i) => {
                              timeline.push({ type: m.author === 'SENROLL' ? 'senroll' : 'client', author: m.author, date: m.date, content: m.content, sortKey: i })
                            })

                            // 2. Add client PJ (from attachments not in replies)
                            const replyPjUrls = new Set((msg.reponse_generee || '').match(/\[PJ\]\s*(https?:\/\/\S+)/g)?.map(m => m.replace('[PJ] ', '')) || [])
                            if (msg.attachments) {
                              msg.attachments.filter(url => !replyPjUrls.has(url)).forEach((url, i) => {
                                timeline.push({ type: 'pj', author: msg.nom_contact, date: '', content: '', pjUrl: url, sortKey: parsed.length > 0 ? 0.5 + i * 0.01 : i })
                              })
                            }

                            // 3. Add sent replies (after conversation messages)
                            if (msg.reponse_generee) {
                              msg.reponse_generee.split('\n---\n').forEach((reply, i) => {
                                const pjMatch = reply.match(/\[PJ\]\s*(https?:\/\/\S+)/)
                                const textOnly = reply.replace(/\n\[PJ\]\s*https?:\/\/\S+/, '').trim()
                                timeline.push({
                                  type: 'senroll', author: 'SENROLL', date: '',
                                  content: textOnly, pjUrl: pjMatch?.[1],
                                  sortKey: 1000 + i
                                })
                              })
                            }

                            // If no parsed messages, show cleaned raw text as first item
                            if (parsed.length === 0 && !msg.reponse_generee) {
                              timeline.push({ type: 'client', author: msg.nom_contact, date: '', content: cleanLbc(msg.message_client || ''), sortKey: 0 })
                            } else if (parsed.length === 0) {
                              timeline.unshift({ type: 'client', author: msg.nom_contact, date: '', content: cleanLbc(msg.message_client || '').substring(0, 300), sortKey: -1 })
                            }

                            return timeline.sort((a, b) => a.sortKey - b.sortKey).map((item, i) => {
                              if (item.type === 'pj') {
                                return (
                                  <div key={`pj-${i}`} className="mr-4">
                                    <a href={item.pjUrl} target="_blank" rel="noopener noreferrer">
                                      <img src={item.pjUrl} alt="PJ" className="rounded border max-h-32 object-cover hover:opacity-80" />
                                    </a>
                                  </div>
                                )
                              }
                              return (
                                <div key={i} className={`rounded p-2 text-xs ${item.type === 'senroll' ? 'bg-blue-50 border border-blue-100 ml-4' : 'bg-white border mr-4'}`}>
                                  <span className={`font-semibold ${item.type === 'senroll' ? 'text-blue-700' : 'text-gray-800'}`}>{item.author}</span>
                                  {item.date && <span className="text-gray-400 ml-1">{item.date}</span>}
                                  <p className="text-gray-700 whitespace-pre-wrap mt-0.5">{item.content}</p>
                                  {item.pjUrl && (
                                    <a href={item.pjUrl} target="_blank" rel="noopener noreferrer" className="block mt-1">
                                      {item.pjUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)
                                        ? <img src={item.pjUrl} alt="PJ" className="rounded border max-h-32 object-cover hover:opacity-80" />
                                        : <span className="text-blue-600 underline text-xs">📎 Voir la piece jointe</span>}
                                    </a>
                                  )}
                                </div>
                              )
                            })
                          })()}
                        </div>

                        {/* Status + Reply */}
                        <div className="border-t px-3 py-2 bg-gray-50 flex items-center gap-2">
                          {['nouveau', 'en_cours', 'traite'].filter(s => s !== msg.statut).map(s => (
                            <button key={s} onClick={(e) => { e.stopPropagation(); changeStatut(msg.id, s) }}
                              className={`text-xs px-2 py-1 rounded ${s === 'nouveau' ? 'bg-orange-100 text-orange-700' : s === 'en_cours' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'} hover:opacity-80`}>
                              → {s === 'nouveau' ? 'Nouveau' : s === 'en_cours' ? 'En cours' : 'Traite'}
                            </button>
                          ))}
                          <button onClick={(e) => { e.stopPropagation(); if (confirm('Archiver cette conversation ?')) changeStatut(msg.id, 'archive') }}
                            className="text-xs px-2 py-1 rounded bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600">
                            Pas interessant
                          </button>
                          {msg.email_contact && !replyTo && (
                            <div className="flex items-center gap-2 ml-auto">
                              <button onClick={(e) => { e.stopPropagation(); handleAutoReply(msg) }} disabled={sending}
                                className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50 font-medium">
                                {sending ? '...' : '⚡ Auto'}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setReplyTo(msg.id) }}
                                className="text-xs text-blue-600 font-medium hover:text-blue-800">Repondre</button>
                            </div>
                          )}
                        </div>

                        {/* Reply input */}
                        {replyTo === msg.id && (
                          <div className="border-t px-3 py-2 bg-white space-y-2">
                            <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)}
                              placeholder="Votre reponse..." rows={2}
                              className="w-full border rounded px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                            {replyFile && (
                              <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded">
                                <span>📎 {replyFile.name}</span>
                                <button onClick={() => setReplyFile(null)} className="text-red-500 hover:text-red-700">×</button>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleReply(msg)} disabled={sending || !replyText.trim()}
                                className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                                {sending ? 'Envoi...' : 'Envoyer'}
                              </button>
                              <label className="text-xs px-2 py-1 rounded cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200">
                                + PJ
                                <input type="file" accept="image/*,.pdf" className="hidden"
                                  onChange={(e) => { setReplyFile(e.target.files?.[0] || null); e.target.value = '' }}
                                  onClick={(e) => e.stopPropagation()} />
                              </label>
                              <button onClick={() => { setReplyTo(null); setReplyText(''); setReplyFile(null) }}
                                className="text-gray-500 px-3 py-1 rounded text-xs hover:bg-gray-100">Annuler</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
