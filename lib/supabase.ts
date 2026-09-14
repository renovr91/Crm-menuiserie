import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetchAvecRelance } from './supabase-fetch'

let _supabase: SupabaseClient | null = null

export function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      { global: { fetch: fetchAvecRelance } }
    )
  }
  return _supabase
}

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { global: { fetch: fetchAvecRelance } }
  )
}
