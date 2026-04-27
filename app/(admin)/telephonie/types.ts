/**
 * Shared types for /telephonie client components.
 */
import type { ExtractedData } from '@/lib/mistral'

export interface RingoverTranscript {
  cdr_id: number
  transcript_text: string | null
  summary: string | null
  extracted: Partial<ExtractedData> | null
  audio_duration_s: number | null
  voxtral_model: string | null
  summary_model: string | null
  created_at: string | null
}

export interface RingoverCallWithTranscript {
  cdr_id: number
  call_id: string
  direction: 'in' | 'out'
  type: string | null
  last_state: string | null
  is_answered: boolean
  start_time: string
  answered_time: string | null
  end_time: string | null
  total_duration: number | null
  incall_duration: number | null
  from_number: string
  to_number: string
  contact_number: string | null
  record_url: string | null
  ringover_user_id: number | null
  ringover_user_email: string | null
  transcript: RingoverTranscript | null
}

export interface TranscribeApiResponse {
  transcript: string
  summary: string
  extracted: Partial<ExtractedData>
  cached: boolean
}
