/**
 * LBC Messaging API Client — via VPS Relay
 *
 * Le CRM n'appelle plus l'API LBC directement.
 * Tout passe par le relay sur le VPS qui forward via proxy résidentiel.
 * Le VPS gère aussi l'auto-refresh des tokens JWT.
 */

const RELAY_URL = process.env.LBC_RELAY_URL || 'http://135.181.46.14:5050'
const RELAY_API_KEY = process.env.LBC_RELAY_API_KEY || 'renov-r-relay-2026'

interface LBCConversation {
  id: string
  topic?: string
  lastMessage?: {
    text: string
    createdAt: string
    senderId: string
  }
  participants?: Array<{
    id: string
    name?: string
  }>
  ad?: {
    id: string
    title: string
    price?: number
    image?: string
  }
  unreadCount?: number
  updatedAt?: string
}

interface LBCMessage {
  id: string
  text: string
  senderId: string
  createdAt: string
  readAt?: string
  attachments?: Array<{
    url: string
    type: string
  }>
}

/**
 * Helper: appel au relay VPS
 */
async function relayFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${RELAY_URL}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': RELAY_API_KEY,
      ...options.headers,
    },
  })
  return res
}

/**
 * List all conversations (cursor-based pagination)
 */
export async function listConversations(pageHash?: string): Promise<any> {
  const params = pageHash
    ? `pageHash=${encodeURIComponent(pageHash)}&next=false&size=50`
    : 'itemsPerPage=50'
  const res = await relayFetch(`/api/conversations?${params}`)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Relay error ${res.status}: ${text}`)
  }

  return res.json()
}

/**
 * Get messages for a specific conversation
 */
export async function getMessages(conversationId: string, page = 1): Promise<any> {
  const res = await relayFetch(`/api/conversations/${conversationId}/messages?page=${page}`)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Relay error ${res.status}: ${text}`)
  }

  return res.json()
}

/**
 * Get conversation details (pro endpoint)
 */
export async function getConversationDetails(conversationId: string): Promise<any> {
  const res = await relayFetch(`/api/conversations/${conversationId}/details`)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Relay error ${res.status}: ${text}`)
  }

  return res.json()
}

/**
 * Send a message in a conversation
 */
export async function sendMessage(conversationId: string, text: string): Promise<any> {
  const res = await relayFetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Relay error ${res.status}: ${errText}`)
  }

  return res.json()
}

/**
 * Mark a message as read
 */
export async function markAsRead(conversationId: string, messageId: string): Promise<void> {
  await relayFetch(`/api/conversations/${conversationId}/messages/${messageId}/read`, {
    method: 'PUT',
  })
}

/**
 * Get unread message count
 */
export async function getUnreadCount(): Promise<any> {
  const res = await relayFetch('/api/unread')

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Relay error ${res.status}: ${text}`)
  }

  return res.json()
}

/**
 * Get ad info by ID
 */
export async function getAdInfo(adId: string): Promise<any> {
  const res = await relayFetch(`/api/ad/${adId}`)
  if (!res.ok) return null
  return res.json()
}

/**
 * Send an attachment (image/file) in a conversation via relay
 * Sends file as base64 in JSON body
 */
export async function sendAttachment(conversationId: string, file: Uint8Array, fileName: string, contentType: string): Promise<any> {
  // Convert to base64
  let base64 = ''
  const bytes = new Uint8Array(file)
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    base64 += String.fromCharCode(...bytes.slice(i, i + chunk))
  }
  base64 = btoa(base64)

  const res = await relayFetch(`/api/conversations/${conversationId}/messages/attachment`, {
    method: 'POST',
    body: JSON.stringify({
      file_base64: base64,
      file_name: fileName,
      content_type: contentType,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Relay error ${res.status}: ${errText}`)
  }

  return res.json()
}

/**
 * Get attachment via relay proxy — returns binary data or redirect URL
 */
export async function getAttachment(path: string, conv?: string): Promise<{ data: ArrayBuffer; contentType: string } | { redirect: string } | null> {
  const convParam = conv ? `?conv=${encodeURIComponent(conv)}` : ''
  const res = await relayFetch(`/api/attachments/${path}${convParam}`)
  if (!res.ok) return null

  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const json = await res.json()
    if (json.redirect) return { redirect: json.redirect }
    return null
  }

  const data = await res.arrayBuffer()
  return { data, contentType: ct || 'application/octet-stream' }
}
