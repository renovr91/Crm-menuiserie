/**
 * LBC Messaging — implémentation Supabase (Tampermonkey relay).
 *
 * Architecture :
 *   CRM → Supabase ← Tampermonkey (Chrome onglet leboncoin.fr)
 *
 * Plus de relay VPS, plus de Hyper-SDK, plus de DataDome solving.
 * Tout passe par les tables :
 *   - lbc_leads          (cache des conversations, sync auto par Tampermonkey)
 *   - lbc_messages       (cache des messages, sync auto par Tampermonkey)
 *   - lbc_actions_queue  (queue d'actions: send_message, mark_read, etc.)
 *
 * Cette lib reste server-side only (utilise SUPABASE_SERVICE_ROLE_KEY).
 */

import { createAdminClient } from './supabase'

const MY_USER_ID = '45b4d579-2ede-4a25-b889-280ffd926393'

// ───────────────────────────────────────────────────────────
// Helpers internes
// ───────────────────────────────────────────────────────────

/**
 * Insère une action dans la queue et attend sa complétion (avec timeout).
 * Si timeout → retourne null et laisse l'action s'exécuter en arrière-plan.
 */
async function enqueueAndWait(
  actionType: string,
  payload: any,
  timeoutMs = 8000
): Promise<{ status: string; response: any; httpStatus: number; error?: string } | null> {
  const supabase = createAdminClient()
  const { data: action, error } = await supabase
    .from('lbc_actions_queue')
    .insert({ action_type: actionType, payload })
    .select()
    .single()
  if (error) throw new Error(`Enqueue failed: ${error.message}`)

  // Poll jusqu'à done/error ou timeout (~200ms d'intervalle)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase
      .from('lbc_actions_queue')
      .select('status, response, http_status, error_message')
      .eq('id', action.id)
      .single()
    if (data && (data.status === 'done' || data.status === 'error')) {
      return {
        status: data.status,
        response: data.response,
        httpStatus: data.http_status,
        error: data.error_message,
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return null // timeout, laisse Tampermonkey finir en arrière-plan
}

/**
 * Insère une action dans la queue et retourne immédiatement (fire-and-forget).
 */
async function enqueueAsync(actionType: string, payload: any): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('lbc_actions_queue').insert({ action_type: actionType, payload })
}

// ───────────────────────────────────────────────────────────
// API publique (signature compatible avec l'ancien relay)
// ───────────────────────────────────────────────────────────

/**
 * List all conversations.
 * Lit le cache Supabase (lbc_leads) — sync auto par Tampermonkey toutes les 30s.
 */
export async function listConversations(_pageHash?: string): Promise<any> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('lbc_leads')
    .select('*')
    .order('dernier_message_date', { ascending: false, nullsFirst: false })
    .limit(100)
  if (error) throw new Error(`Supabase error: ${error.message}`)

  const conversations = (data || []).map((lead: any) => ({
    conversationId: lead.conversation_id,
    partnerName: lead.contact_name || 'Inconnu',
    partnerId: '',
    itemId: lead.ad_id || '',
    itemType: 'ad',
    subject: `Nouveau message pour "${lead.ad_title || ''}" sur leboncoin`,
    lastMessagePreview: lead.dernier_message || '',
    lastMessageCreatedAt: lead.dernier_message_date,
    lastMessageDate: lead.dernier_message_date,
    unseenCounter: lead.unread_count ?? 0,
    partnerProfilePictureUrl: '',
    pageHash: '',
  }))

  return { _embedded: { conversations }, _links: {} }
}

/**
 * Get messages for a specific conversation.
 * Lit le cache Supabase (lbc_messages) — sync auto par Tampermonkey.
 * Si la conv n'a pas de messages cachés, déclenche un fetch_messages côté Tampermonkey.
 */
export async function getMessages(conversationId: string, page = 1): Promise<any> {
  const supabase = createAdminClient()
  const pageSize = 50
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('lbc_messages')
    .select('*', { count: 'exact' })
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw new Error(`Supabase error: ${error.message}`)

  // Si vide → demander au Tampermonkey de fetch (fire-and-forget, pour la prochaine fois)
  if (!data || data.length === 0) {
    enqueueAsync('fetch_messages', { conv_id: conversationId }).catch(() => {})
  }

  // Format compatible HAL (les anciens consommateurs attendent _embedded.messages)
  // Inverse pour avoir les plus anciens en haut comme l'API LBC originale
  const messages = (data || [])
    .slice()
    .reverse()
    .map((m: any) => ({
      id: m.id,
      body: m.text || '',
      text: m.text || '',
      senderId: m.sender_id || '',
      outgoing: m.is_me === true,
      createdAt: m.created_at,
      sentAt: m.created_at,
      readAt: m.read_at,
      attachments: m.attachments || [],
    }))

  return {
    _embedded: { messages },
    items: messages,
    size: messages.length,
    total: count ?? messages.length,
  }
}

/**
 * Get conversation details (info enrichie d'une conv).
 */
export async function getConversationDetails(conversationId: string): Promise<any> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('lbc_leads')
    .select('*')
    .eq('conversation_id', conversationId)
    .single()
  if (error) return { conversation: null }
  return {
    conversation: data,
    conversationId,
    contactName: data?.contact_name,
    adTitle: data?.ad_title,
    adId: data?.ad_id,
  }
}

/**
 * Send a message in a conversation.
 * Insère un message optimiste (UI immédiate) + une action dans la queue.
 * Tampermonkey exécute le POST → met à jour le message Supabase avec le vrai id.
 */
export async function sendMessage(conversationId: string, text: string): Promise<any> {
  const supabase = createAdminClient()
  const tempId = `temp_${crypto.randomUUID()}`

  // 1. Optimistic UI : insert direct dans lbc_messages
  await supabase.from('lbc_messages').insert({
    id: tempId,
    conversation_id: conversationId,
    text,
    sender_id: MY_USER_ID,
    is_me: true,
    created_at: new Date().toISOString(),
  })

  // 2. Mettre à jour lbc_leads pour reflect le dernier message
  await supabase
    .from('lbc_leads')
    .update({
      dernier_message: text,
      dernier_message_date: new Date().toISOString(),
      dernier_message_is_me: true,
    })
    .eq('conversation_id', conversationId)

  // 3. Enqueue l'action et attendre la complétion (avec timeout)
  const result = await enqueueAndWait(
    'send_message',
    { conv_id: conversationId, text, temp_id: tempId },
    8000
  )

  if (result?.status === 'error') {
    // Marquer le message comme failed dans le cache (le frontend pourra afficher une erreur)
    await supabase
      .from('lbc_messages')
      .update({ raw: { failed: true, error: result.error } })
      .eq('id', tempId)
    throw new Error(result.error || 'Send failed')
  }

  return {
    ok: true,
    messageId: tempId,
    optimistic: !result, // true si timeout (mais l'action continue en bg)
    response: result?.response,
  }
}

/**
 * Mark a message as read (fire-and-forget).
 */
export async function markAsRead(conversationId: string, messageId: string): Promise<void> {
  await enqueueAsync('mark_read', { conv_id: conversationId, message_id: messageId })

  // Marquer aussi dans le cache local
  const supabase = createAdminClient()
  await supabase
    .from('lbc_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
}

/**
 * Get unread message count (compteur global).
 */
export async function getUnreadCount(): Promise<any> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('lbc_total_unread')
  if (error) throw new Error(`Supabase error: ${error.message}`)
  return {
    unread: data ?? 0,
    userId: MY_USER_ID,
  }
}

/**
 * Get ad info by ID — DEPRECATED.
 * Les annonces LBC expirent vite et retournent 404.
 * On ne fait plus d'enrichissement automatique.
 */
export async function getAdInfo(_adId: string): Promise<any> {
  return null
}

/**
 * Send an attachment (image/file) — TODO via Tampermonkey.
 * Pour l'instant, le CRM utilise le fallback email-relay (Gmail SMTP).
 */
export async function sendAttachment(
  _conversationId: string,
  _file: Uint8Array,
  _fileName: string,
  _contentType: string
): Promise<any> {
  throw new Error('sendAttachment via Supabase relay — pas encore implémenté. Utilise email-relay (relayEmail).')
}

/**
 * Get attachment via relay proxy — TODO.
 * Pour l'instant on retourne null, le CRM fallback sur lien LBC direct.
 */
export async function getAttachment(
  _path: string,
  _conv?: string
): Promise<{ data: ArrayBuffer; contentType: string } | { redirect: string } | null> {
  return null
}
