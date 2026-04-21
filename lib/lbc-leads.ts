/**
 * LBC Leads — Gestion des leads depuis la messagerie LBC
 *
 * Persiste les conversations LBC dans Supabase avec un statut de pipeline,
 * des notes, la ville/département, et le lien vers la fiche client.
 */

import { createAdminClient } from './supabase'
import { listConversations, getAdInfo } from './lbc-messaging'

// Types
export type LeadStatut = 'nouveau' | 'repondu' | 'devis_envoye' | 'en_attente' | 'relance' | 'gagne' | 'perdu' | 'pas_interesse'

export interface LBCLead {
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
  client_id: string | null
  notes: string | null
  telephone: string | null
  dernier_message: string | null
  dernier_message_date: string | null
  dernier_message_is_me: boolean
  unread_count: number
  classification: any
  created_at: string
  updated_at: string
}

export interface LeadWithCounts {
  leads: LBCLead[]
  counts: Record<LeadStatut, number>
}

const MY_USER_ID = '45b4d579-2ede-4a25-b889-280ffd926393'

// =============================================
// SYNC : Conversations LBC → Supabase
// =============================================

/**
 * Synchronise les conversations LBC avec la table lbc_leads.
 * Crée les nouveaux leads, met à jour les existants.
 */
export async function syncConversationsToLeads(): Promise<{ synced: number; created: number; updated: number }> {
  const supabase = createAdminClient()
  let synced = 0, created = 0, updated = 0

  // Charger toutes les conversations LBC (première page)
  const data = await listConversations()
  const rawConvs = data._embedded?.conversations || data.conversations || []

  if (rawConvs.length === 0) return { synced, created, updated }

  // Récupérer les leads existants
  const convIds = rawConvs.map((c: any) => c.conversationId || c.id)
  const { data: existingLeads } = await supabase
    .from('lbc_leads')
    .select('conversation_id, statut, dernier_message_date, city, zip_code')
    .in('conversation_id', convIds)

  const existingMap = new Map(
    (existingLeads || []).map((l: any) => [l.conversation_id, l])
  )

  // Collecter les adIds pour enrichir : nouveaux leads + existants sans ville
  const adIdsToEnrich = [...new Set(
    rawConvs
      .filter((c: any) => {
        const convId = c.conversationId || c.id
        const existing = existingMap.get(convId)
        // Enrichir si nouveau OU si existant sans ville
        return !existing || !existing.city
      })
      .map((c: any) => String(c.itemId))
      .filter(Boolean)
  )] as string[]
  const adInfoMap = new Map<string, any>()

  // Enrichir en parallèle (max 5 simultanés)
  const chunks: string[][] = []
  for (let i = 0; i < adIdsToEnrich.length; i += 5) {
    chunks.push(adIdsToEnrich.slice(i, i + 5))
  }
  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (adId) => {
        const info = await getAdInfo(adId)
        if (info) adInfoMap.set(adId, info)
      })
    )
  }

  // Préparer les inserts et updates en batch
  const toInsert: any[] = []
  const toUpdate: Array<{ convId: string; updates: any }> = []

  for (const conv of rawConvs) {
    const convId = conv.conversationId || conv.id
    const contactName = conv.partnerName || conv.participants?.find((p: any) => p.id !== MY_USER_ID)?.name || 'Inconnu'
    const lastMsg = conv.lastMessagePreview || conv.lastMessage?.text || ''
    const lastMsgDate = conv.lastMessageCreatedAt || conv.lastMessageDate || conv.updatedAt || null
    const isMe = conv.lastMessageSenderId === MY_USER_ID || conv.lastMessageOutgoing === true
    const adId = conv.itemId || ''
    const subject = conv.subject || ''
    const adTitleMatch = subject.match(/"([^"]+)"/)
    const adTitle = adTitleMatch ? adTitleMatch[1] : subject

    // Enrichir avec adInfo (plusieurs formats possibles selon l'API)
    const adInfo = adInfoMap.get(adId)
    const city = adInfo?.location?.city_label || adInfo?.location?.city || adInfo?.city_label || adInfo?.city || null
    const zipCode = adInfo?.location?.zipcode || adInfo?.location?.zip_code || adInfo?.location?.zip || adInfo?.zipcode || adInfo?.zip_code || null
    const departement = zipCode ? zipCode.substring(0, 2) : null
    const adPrice = adInfo?.price ? `${adInfo.price}€` : adInfo?.price_cents ? `${Math.round(adInfo.price_cents / 100)}€` : null

    // Détecter un numéro de téléphone dans le dernier message
    const phone = extractPhone(lastMsg)

    // Compteur messages non lus (unseenCounter de l'API LBC)
    const unreadCount = conv.unseenCounter ?? conv.unseen_counter ?? conv.unreadCount ?? 0

    const existing = existingMap.get(convId)

    if (!existing) {
      toInsert.push({
        conversation_id: convId,
        contact_name: contactName,
        ad_id: adId,
        ad_title: adTitle,
        ad_price: adPrice,
        city,
        zip_code: zipCode,
        departement,
        statut: 'nouveau',
        telephone: phone,
        dernier_message: lastMsg,
        dernier_message_date: lastMsgDate,
        dernier_message_is_me: isMe,
        unread_count: unreadCount,
      })
    } else {
      const updates: any = {
        dernier_message: lastMsg,
        dernier_message_date: lastMsgDate,
        dernier_message_is_me: isMe,
        contact_name: contactName,
        unread_count: unreadCount,
      }
      if (city && !existing.city) updates.city = city
      if (zipCode && !existing.zip_code) updates.zip_code = zipCode
      if (departement && !existing.departement) updates.departement = departement
      if (adPrice) updates.ad_price = adPrice
      if (phone && !existing.telephone) updates.telephone = phone
      toUpdate.push({ convId, updates })
    }
    synced++
  }

  // Batch insert nouveaux leads
  if (toInsert.length > 0) {
    const { error } = await supabase.from('lbc_leads').insert(toInsert)
    if (!error) created = toInsert.length
  }

  // Updates en parallèle (max 10 simultanés)
  const updateChunks: Array<{ convId: string; updates: any }>[] = []
  for (let i = 0; i < toUpdate.length; i += 10) {
    updateChunks.push(toUpdate.slice(i, i + 10))
  }
  for (const chunk of updateChunks) {
    await Promise.allSettled(
      chunk.map(async ({ convId, updates }) => {
        const { error } = await supabase
          .from('lbc_leads')
          .update(updates)
          .eq('conversation_id', convId)
        if (!error) updated++
      })
    )
  }

  return { synced, created, updated }
}

// =============================================
// CRUD
// =============================================

/**
 * Récupère tous les leads avec comptage par statut
 */
export async function getLeads(filters?: {
  statut?: LeadStatut
  departement?: string
  search?: string
}): Promise<LeadWithCounts> {
  const supabase = createAdminClient()

  // Requête de base
  let query = supabase
    .from('lbc_leads')
    .select('*')
    .order('dernier_message_date', { ascending: false, nullsFirst: false })

  if (filters?.statut) {
    query = query.eq('statut', filters.statut)
  }
  if (filters?.departement) {
    query = query.eq('departement', filters.departement)
  }
  if (filters?.search) {
    const s = `%${filters.search}%`
    query = query.or(`contact_name.ilike.${s},city.ilike.${s},zip_code.ilike.${s},ad_title.ilike.${s},telephone.ilike.${s},dernier_message.ilike.${s}`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  // Comptage par statut (toujours sur tous les leads, pas filtré)
  const { data: allLeads } = await supabase
    .from('lbc_leads')
    .select('statut')

  const counts: Record<LeadStatut, number> = {
    nouveau: 0, repondu: 0, devis_envoye: 0, en_attente: 0, relance: 0, gagne: 0, perdu: 0, pas_interesse: 0
  }
  for (const l of (allLeads || [])) {
    if (l.statut in counts) counts[l.statut as LeadStatut]++
  }

  return { leads: (data || []) as LBCLead[], counts }
}

/**
 * Met à jour le statut d'un lead + historique
 */
export async function updateLeadStatus(
  conversationId: string,
  newStatut: LeadStatut,
  note?: string
): Promise<void> {
  const supabase = createAdminClient()

  // Récupérer l'ancien statut
  const { data: lead } = await supabase
    .from('lbc_leads')
    .select('id, statut')
    .eq('conversation_id', conversationId)
    .single()

  if (!lead) throw new Error('Lead non trouvé')

  const oldStatut = lead.statut

  // Mettre à jour
  const { error } = await supabase
    .from('lbc_leads')
    .update({ statut: newStatut })
    .eq('conversation_id', conversationId)

  if (error) throw new Error(error.message)

  // Historique
  await supabase.from('lbc_lead_history').insert({
    lead_id: lead.id,
    old_statut: oldStatut,
    new_statut: newStatut,
    note: note || null,
  })
}

/**
 * Ajouter/mettre à jour les notes d'un lead
 */
export async function updateLeadNotes(conversationId: string, notes: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('lbc_leads')
    .update({ notes })
    .eq('conversation_id', conversationId)
  if (error) throw new Error(error.message)
}

/**
 * Mettre à jour le téléphone d'un lead
 */
export async function updateLeadPhone(conversationId: string, telephone: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('lbc_leads')
    .update({ telephone })
    .eq('conversation_id', conversationId)
  if (error) throw new Error(error.message)
}

// =============================================
// TEMPLATES
// =============================================

export interface Template {
  id: string
  cas: string
  label: string
  contenu: string
  actif: boolean
}

export async function getTemplates(): Promise<Template[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('actif', true)
    .order('cas')
  if (error) throw new Error(error.message)
  return (data || []) as Template[]
}

// =============================================
// HELPERS
// =============================================

/**
 * Extrait un numéro de téléphone français depuis un texte
 */
export function extractPhone(text: string): string | null {
  if (!text) return null
  // Formats FR : 06 12 34 56 78, 0612345678, +33612345678, etc.
  const patterns = [
    /(?:\+33|0033)\s*[67]\s*(?:\d\s*){8}/,
    /0[67]\s*(?:\d\s*){8}/,
    /(?:\+33|0033)\s*[1-9]\s*(?:\d\s*){8}/,
    /0[1-9]\s*(?:\d\s*){8}/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      // Nettoyer : garder uniquement les chiffres et le +
      return match[0].replace(/\s/g, '')
    }
  }
  return null
}

/**
 * Extrait le département depuis un code postal
 */
export function extractDepartement(zipCode: string | null): string | null {
  if (!zipCode || zipCode.length < 2) return null
  return zipCode.substring(0, 2)
}
