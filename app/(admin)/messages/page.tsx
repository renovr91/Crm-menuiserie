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
  created_at: string
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<SavedMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ imported: number; updated: number; total: number } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'phone' | 'nophone'>('all')

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

  const filtered = messages.filter(m => {
    if (filter === 'phone') return !!m.telephone
    if (filter === 'nophone') return !m.telephone
    return true
  })

  const nbWithPhone = messages.filter(m => m.telephone).length

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
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Messages LeBonCoin</h1>
        <span className="text-sm text-gray-400">{messages.length} conversations</span>
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

      {/* Messages list */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 text-sm">Chargement...</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((msg) => (
            <div
              key={msg.id}
              className="bg-white rounded-xl shadow-sm border overflow-hidden"
            >
              <div
                className="flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpanded(expanded === msg.id ? null : msg.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{msg.nom_contact || 'Inconnu'}</span>
                    <span className="text-gray-400 text-sm">—</span>
                    <span className="text-sm text-gray-600 truncate">{msg.titre_annonce}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-400">{new Date(msg.date_email || msg.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {msg.telephone && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">{msg.telephone}</span>}
                    {msg.has_attachment && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">PJ</span>}
                  </div>
                </div>
                <span className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1">
                  {expanded === msg.id ? 'Fermer' : 'Voir'}
                </span>
              </div>

              {expanded === msg.id && (() => {
                const parsed = parseConversation(msg.message_client || '')

                if (parsed.length > 0) {
                  return (
                    <div className="border-t px-4 py-3 bg-gray-50 space-y-2 max-h-96 overflow-y-auto">
                      <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                        <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-medium">{msg.titre_annonce}</span>
                        {msg.has_attachment && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded">PJ</span>}
                        {msg.telephone && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">{msg.telephone}</span>}
                      </div>
                      {/* Attached photos */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-2">
                          {msg.attachments.map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt={`PJ ${i + 1}`} className="rounded-lg border max-h-48 object-cover hover:opacity-80 transition-opacity" />
                            </a>
                          ))}
                        </div>
                      )}
                      {parsed.reverse().map((m, i) => (
                        <div key={i} className={`rounded-lg p-3 text-sm ${m.author === 'SENROLL' ? 'bg-blue-50 border border-blue-100 ml-8' : 'bg-white border mr-8'}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`font-semibold text-xs ${m.author === 'SENROLL' ? 'text-blue-700' : 'text-gray-800'}`}>{m.author}</span>
                            <span className="text-xs text-gray-400">{m.date}</span>
                          </div>
                          <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{m.content}</p>
                        </div>
                      ))}
                    </div>
                  )
                }

                // Fallback
                return (
                  <div className="border-t px-4 py-3 bg-gray-50">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex gap-2 flex-wrap mb-3">
                        {msg.attachments.map((url: string, i: number) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={`PJ ${i + 1}`} className="rounded-lg border max-h-48 object-cover hover:opacity-80 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="text-gray-700 whitespace-pre-wrap text-sm leading-relaxed max-h-96 overflow-y-auto">
                      {cleanLbc(msg.message_client || '')}
                    </div>
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500 text-sm">Aucun message. Cliquez &quot;Mettre a jour depuis Gmail&quot; pour importer.</p>
        </div>
      )}
    </div>
  )
}
