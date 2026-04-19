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
 * List all conversations
 */
export async function listConversations(page = 1, itemsPerPage = 30): Promise<any> {
  const res = await relayFetch(`/api/conversations?page=${page}&itemsPerPage=${itemsPerPage}`)

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
