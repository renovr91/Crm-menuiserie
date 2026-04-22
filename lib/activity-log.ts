import { createAdminClient } from './supabase'

export type ActionType =
  | 'lead_status_change'
  | 'lead_note_update'
  | 'message_sent'
  | 'message_read'
  | 'client_create'
  | 'client_update'
  | 'affaire_create'
  | 'affaire_update'
  | 'affaire_stage_change'
  | 'devis_create'
  | 'devis_update'
  | 'tache_create'
  | 'tache_done'
  | 'tache_update'
  | 'login'

export type EntityType = 'client' | 'affaire' | 'lead_lbc' | 'tache' | 'devis' | 'message_lbc'

interface LogEntry {
  commercial_id: string | null
  user_id?: string
  action_type: ActionType
  entity_type?: EntityType
  entity_id?: string
  details?: Record<string, unknown>
}

export async function logActivity(entry: LogEntry) {
  try {
    const supabase = createAdminClient()
    await supabase.from('activity_log').insert({
      commercial_id: entry.commercial_id === 'admin' ? null : entry.commercial_id,
      user_id: entry.user_id || null,
      action_type: entry.action_type,
      entity_type: entry.entity_type || null,
      entity_id: entry.entity_id || null,
      details: entry.details || {},
    })
  } catch {
    // Never let logging break the main flow
    console.error('[activity-log] Failed to log activity')
  }
}

export async function getRecentActivity(limit = 50) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('activity_log')
    .select('*, commerciaux(nom, couleur)')
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}
