'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Conversation {
  id: string
  lastMessage: string
  lastMessageDate: string
  contactName: string
  adTitle: string
  adId: string
  unread: boolean
  unseenCount: number
  city?: string
  zipCode?: string
  adPrice?: string
}

interface Attachment {
  url: string
  type: string
  fileName?: string
}

interface Message {
  id: string
  text: string
  senderId: string
  createdAt: string
  isMe: boolean
  senderName: string
  attachments: Attachment[]
}

const MY_USER_ID = '45b4d579-2ede-4a25-b889-280ffd926393'

function extractAdTitle(subject: string): string {
  const match = subject?.match(/"([^"]+)"/)
  return match ? match[1] : subject || ''
}

export default function MessagerieLBCPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const [convPage, setConvPage] = useState(1)
  const [hasMoreConvs, setHasMoreConvs] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // --- Load conversations (with pagination) ---
  const loadConversations = useCallback(async (page = 1, append = false) => {
    try {
      setError(null)
      if (page === 1) setLoading(true)
      else setLoadingMore(true)

      const res = await fetch(`/api/lbc-messaging?action=conversations&page=${page}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Erreur API')
      }
      const data = await res.json()

      const rawConvs = data._embedded?.conversations || data.conversations || []
      const convs: Conversation[] = rawConvs.map((c: any) => ({
        id: c.conversationId || c.id,
        lastMessage: c.lastMessagePreview || c.lastMessage?.text || '',
        lastMessageDate: c.lastMessageCreatedAt || c.lastMessageDate || c.updatedAt || '',
        contactName: c.partnerName || c.participants?.find((p: any) => p.id !== MY_USER_ID)?.name || 'Inconnu',
        adTitle: extractAdTitle(c.subject || ''),
        adId: c.itemId || '',
        unread: (c.unseenCounter || 0) > 0,
        unseenCount: c.unseenCounter || 0,
      }))

      // S'il y a moins de 30 résultats, pas de page suivante
      setHasMoreConvs(rawConvs.length >= 30)

      if (append) {
        setConversations(prev => {
          const existingIds = new Set(prev.map(c => c.id))
          const newConvs = convs.filter(c => !existingIds.has(c.id))
          return [...prev, ...newConvs]
        })
      } else {
        setConversations(convs)
      }
      enrichConversations(convs)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // --- Load more conversations ---
  const loadMoreConversations = useCallback(() => {
    const nextPage = convPage + 1
    setConvPage(nextPage)
    loadConversations(nextPage, true)
  }, [convPage, loadConversations])

  // --- Enrich with ad info ---
  const enrichConversations = async (convs: Conversation[]) => {
    const adIds = [...new Set(convs.map(c => c.adId).filter(Boolean))]
    const batchSize = 10
    for (let i = 0; i < adIds.length; i += batchSize) {
      const batch = adIds.slice(i, i + batchSize)
      const results = await Promise.allSettled(
        batch.map(async (adId) => {
          try {
            const res = await fetch(`/api/lbc-messaging?action=adinfo&adId=${adId}`)
            if (!res.ok) return null
            const data = await res.json()
            return { adId, data }
          } catch { return null }
        })
      )

      setConversations(prev => {
        const updated = [...prev]
        for (const result of results) {
          if (result.status !== 'fulfilled' || !result.value) continue
          const { adId, data } = result.value
          if (!data || data.error) continue
          for (const conv of updated) {
            if (conv.adId === adId) {
              conv.city = data.location?.city || data.city || ''
              conv.zipCode = data.location?.zipcode || data.zipcode || data.location?.zip || ''
              conv.adPrice = data.price ? `${data.price}€` : data.price_cents ? `${Math.round(data.price_cents / 100)}€` : ''
            }
          }
        }
        return updated
      })
    }
  }

  // --- Load messages ---
  const loadMessages = useCallback(async (convId: string, contactName: string, _retryCount = 0) => {
    try {
      setLoadingMessages(true)
      const res = await fetch(`/api/lbc-messaging?action=messages&conv=${convId}`)
      if (!res.ok) throw new Error('Erreur chargement messages')
      const data = await res.json()

      const rawMsgs = data._embedded?.messages || data.messages || []

      const msgs: Message[] = rawMsgs.map((m: any) => {
        // LBC utilise "outgoing: true" pour nos messages, pas de senderId
        const isMe = m.outgoing === true

        return {
          id: m.messageId || m.id,
          text: m.text || m.body || '',
          senderId: isMe ? MY_USER_ID : 'partner',
          createdAt: m.createdAt || m.date || '',
          isMe,
          senderName: isMe ? 'Moi (Renov-R)' : contactName,
          attachments: (m.attachments || []).map((a: any) => {
            // LBC utilise "path" (relatif) et "contentType"
            const attPath = a.path || ''
            const attUrl = a.url || (attPath ? `/api/lbc-messaging?action=attachment&path=${encodeURIComponent(attPath)}&conv=${encodeURIComponent(convId)}` : '')
            return {
              url: attUrl,
              type: a.contentType || a.type || 'application/octet-stream',
              fileName: attPath ? attPath.split('/').pop() || 'fichier' : 'fichier',
            }
          }).filter((a: Attachment) => a.url),
        }
      })

      setMessages(msgs.reverse())

      // Marquer le dernier message comme lu
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

  // --- Load unread count ---
  const loadUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/lbc-messaging?action=unread')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count || data.unreadCount || data.counter || 0)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadConversations()
    loadUnread()
  }, [loadConversations, loadUnread])

  useEffect(() => {
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [messages])

  useEffect(() => {
    if (selectedConv) inputRef.current?.focus()
  }, [selectedConv])

  // --- Select conversation ---
  const selectConv = (conv: Conversation) => {
    setSelectedConv(conv)
    setReplyText('')
    loadMessages(conv.id, conv.contactName)

    // Marquer localement comme lu
    if (conv.unread) {
      setConversations(prev => prev.map(c =>
        c.id === conv.id ? { ...c, unread: false, unseenCount: 0 } : c
      ))
    }
  }

  // --- Send message ---
  const handleSend = async () => {
    if (!replyText.trim() || !selectedConv || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/lbc-messaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', conv: selectedConv.id, text: replyText.trim() }),
      })
      if (!res.ok) throw new Error('Erreur envoi')

      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        text: replyText.trim(),
        senderId: MY_USER_ID,
        createdAt: new Date().toISOString(),
        isMe: true,
        senderName: 'Moi (Renov-R)',
        attachments: [],
      }])
      setReplyText('')
      inputRef.current?.focus()
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

  const filteredConvs = conversations.filter(c => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (c.contactName?.toLowerCase().includes(q) ||
      c.adTitle?.toLowerCase().includes(q) ||
      c.lastMessage?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.zipCode?.includes(q))
  })

  const formatDate = (dateStr: string) => {
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

  return (
    <div className="h-full flex" style={{ background: 'var(--bg-primary)' }}>

      {/* LEFT PANEL */}
      <div className="w-96 shrink-0 flex flex-col border-r" style={{ borderColor: 'var(--border-default)' }}>

        <div className="p-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Messagerie LBC
              {unreadCount > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-red-500 text-white">
                  {unreadCount}
                </span>
              )}
            </h1>
            <button
              onClick={() => { setLoading(true); loadConversations(); loadUnread() }}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-default)',
              }}
            >
              Rafraîchir
            </button>
          </div>

          <input
            type="text"
            placeholder="Rechercher nom, ville, CP..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>Chargement...</div>
          ) : error ? (
            <div className="p-4 text-center">
              <p className="text-red-400 text-sm mb-2">{error}</p>
              <button onClick={() => { setLoading(true); loadConversations() }}
                className="text-xs text-cyan-400 hover:underline">Réessayer</button>
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="p-8 text-center" style={{ color: 'var(--text-tertiary)' }}>Aucune conversation</div>
          ) : (
            <>
              {filteredConvs.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => selectConv(conv)}
                  className="w-full text-left px-4 py-3 border-b transition-colors"
                  style={{
                    borderColor: 'var(--border-default)',
                    background: selectedConv?.id === conv.id ? 'var(--bg-tertiary)' : 'transparent',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-medium"
                      style={{
                        background: conv.unread ? 'rgba(14, 165, 233, 0.15)' : 'var(--bg-tertiary)',
                        color: conv.unread ? '#0EA5E9' : 'var(--text-tertiary)',
                      }}>
                      {conv.contactName?.[0]?.toUpperCase() || '?'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm truncate" style={{
                          color: conv.unread ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontWeight: conv.unread ? 600 : 400,
                        }}>
                          {conv.contactName}
                        </span>
                        <span className="text-xs shrink-0 ml-2" style={{ color: 'var(--text-tertiary)' }}>
                          {formatDate(conv.lastMessageDate)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {conv.adTitle && (
                          <span className="text-xs truncate" style={{ color: '#0284C7' }}>
                            {conv.adTitle}
                          </span>
                        )}
                        {(conv.city || conv.zipCode) && (
                          <span className="text-xs shrink-0 px-1.5 rounded" style={{
                            background: 'rgba(168, 85, 247, 0.12)',
                            color: '#9333EA',
                            fontSize: '10px',
                          }}>
                            {conv.zipCode || ''} {conv.city || ''}
                          </span>
                        )}
                        {conv.adPrice && (
                          <span className="text-xs shrink-0 font-medium" style={{ color: '#16A34A' }}>
                            {conv.adPrice}
                          </span>
                        )}
                      </div>

                      <div className="text-xs truncate mt-0.5" style={{
                        color: conv.unread ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      }}>
                        {conv.lastMessage || '...'}
                      </div>
                    </div>

                    {conv.unread && (
                      <div className="shrink-0 mt-2 min-w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: '#0EA5E9', color: '#fff' }}>
                        {conv.unseenCount}
                      </div>
                    )}
                  </div>
                </button>
              ))}

              {/* Bouton charger plus */}
              {hasMoreConvs && !searchQuery && (
                <button
                  onClick={loadMoreConversations}
                  disabled={loadingMore}
                  className="w-full py-4 text-sm font-semibold transition-all hover:opacity-90"
                  style={{
                    color: '#fff',
                    background: 'linear-gradient(135deg, #0284C7, #0EA5E9)',
                    borderTop: '1px solid var(--border-default)',
                  }}
                >
                  {loadingMore ? '⏳ Chargement...' : '⬇ Voir plus de conversations'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL — Chat */}
      <div className="flex-1 flex flex-col">
        {!selectedConv ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
            <div className="text-center">
              <div className="text-4xl mb-4">💬</div>
              <p>Sélectionnez une conversation</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-6 py-3 border-b flex items-center gap-4" style={{ borderColor: 'var(--border-default)' }}>
              <button onClick={() => setSelectedConv(null)} className="lg:hidden text-sm" style={{ color: 'var(--text-secondary)' }}>←</button>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium"
                style={{ background: 'rgba(14, 165, 233, 0.15)', color: '#0EA5E9' }}>
                {selectedConv.contactName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {selectedConv.contactName}
                  </span>
                  {(selectedConv.city || selectedConv.zipCode) && (
                    <span className="text-xs px-1.5 rounded" style={{
                      background: 'rgba(168, 85, 247, 0.12)',
                      color: '#9333EA',
                      fontSize: '10px',
                    }}>
                      {selectedConv.zipCode} {selectedConv.city}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedConv.adTitle && (
                    <span className="text-xs truncate" style={{ color: '#0284C7' }}>
                      {selectedConv.adTitle}
                    </span>
                  )}
                  {selectedConv.adPrice && (
                    <span className="text-xs font-medium" style={{ color: '#16A34A' }}>
                      {selectedConv.adPrice}
                    </span>
                  )}
                </div>
              </div>
              <a
                href={`https://www.leboncoin.fr/messages/${selectedConv.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 text-xs rounded-lg"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-default)',
                }}
              >
                Voir sur LBC
              </a>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {loadingMessages ? (
                <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Chargement des messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8" style={{ color: 'var(--text-tertiary)' }}>Aucun message</div>
              ) : (
                messages.map((msg, i) => {
                  // Afficher le nom si c'est le premier message ou si l'expéditeur change
                  const showName = i === 0 || messages[i - 1].isMe !== msg.isMe
                  return (
                    <div key={msg.id} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`} style={{ maxWidth: '75%' }}>
                        {/* Sender name */}
                        {showName && (
                          <div className="text-[11px] font-semibold mb-1 px-2 flex items-center gap-1.5" style={{
                            color: msg.isMe ? '#0284C7' : '#D946EF',
                          }}>
                            <span style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: msg.isMe ? '#0284C7' : '#D946EF',
                              display: 'inline-block',
                            }} />
                            {msg.senderName}
                          </div>
                        )}

                        {/* Message bubble */}
                        <div
                          className="px-4 py-2.5 rounded-2xl text-sm"
                          style={{
                            background: msg.isMe
                              ? 'linear-gradient(135deg, #0284C7, #0EA5E9)'
                              : 'var(--bg-tertiary)',
                            color: msg.isMe ? '#fff' : 'var(--text-primary)',
                            borderBottomRightRadius: msg.isMe ? '4px' : undefined,
                            borderBottomLeftRadius: !msg.isMe ? '4px' : undefined,
                            border: msg.isMe ? 'none' : '2px solid var(--border-default)',
                          }}
                        >
                          <div className="whitespace-pre-wrap break-words">{msg.text}</div>

                          {/* Pièces jointes */}
                          {msg.attachments.length > 0 && (
                            <div className="mt-2 space-y-2">
                              {msg.attachments.map((att, idx) => {
                                const isImage = att.type?.startsWith('image')
                                const isPdf = att.type === 'application/pdf'

                                const handleAttClick = async (e: React.MouseEvent) => {
                                  e.preventDefault()
                                  try {
                                    const res = await fetch(att.url)
                                    const ct = res.headers.get('content-type') || ''
                                    if (ct.includes('application/json')) {
                                      const json = await res.json()
                                      if (json.redirect) {
                                        window.open(json.redirect, '_blank')
                                        return
                                      }
                                    }
                                    // Fichier binaire direct
                                    const blob = await res.blob()
                                    const blobUrl = URL.createObjectURL(blob)
                                    window.open(blobUrl, '_blank')
                                  } catch {
                                    window.open(att.url, '_blank')
                                  }
                                }

                                return isImage ? (
                                  <a key={idx} href={att.url} onClick={handleAttClick} className="cursor-pointer">
                                    <img
                                      src={att.url}
                                      alt="Pièce jointe"
                                      className="max-w-xs rounded-lg hover:opacity-80 transition-opacity"
                                      style={{ maxHeight: '200px' }}
                                    />
                                  </a>
                                ) : (
                                  <button key={idx} onClick={handleAttClick}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer"
                                    style={{
                                      background: msg.isMe ? 'rgba(255,255,255,0.2)' : 'rgba(14, 165, 233, 0.1)',
                                      color: msg.isMe ? '#fff' : '#0284C7',
                                      border: msg.isMe ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(14, 165, 233, 0.3)',
                                    }}>
                                    {isPdf ? '📄' : '📎'} {isPdf ? 'Document PDF' : `Fichier (${att.type?.split('/')[1] || 'télécharger'})`}
                                  </button>
                                )
                              })}
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

            {/* Reply */}
            <div className="px-6 py-3 border-t" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex items-end gap-3">
                <textarea
                  ref={inputRef}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Écrire un message..."
                  rows={1}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none resize-none"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)',
                    maxHeight: '120px',
                  }}
                  onInput={e => {
                    const target = e.target as HTMLTextAreaElement
                    target.style.height = 'auto'
                    target.style.height = Math.min(target.scrollHeight, 120) + 'px'
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
              <div className="mt-1.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                Entrée pour envoyer · Shift+Entrée pour un saut de ligne
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
