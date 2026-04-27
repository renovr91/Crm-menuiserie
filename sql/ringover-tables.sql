-- ============================================
-- Ringover Telephony Tables
-- Applied via MCP Supabase migration: ringover_telephony_tables
-- ============================================

-- Cache des appels Ringover (synchronisé depuis l'API)
CREATE TABLE IF NOT EXISTS ringover_calls (
  cdr_id              bigint PRIMARY KEY,
  call_id             text NOT NULL,
  direction           text NOT NULL CHECK (direction IN ('in', 'out')),
  type                text,
  last_state          text,
  is_answered         boolean DEFAULT false,
  start_time          timestamptz NOT NULL,
  answered_time       timestamptz,
  end_time            timestamptz,
  total_duration      int,
  incall_duration     int,
  from_number         text NOT NULL,
  to_number           text NOT NULL,
  contact_number      text,
  record_url          text,
  ringover_user_id    bigint,
  ringover_user_email text,
  raw                 jsonb,
  synced_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ringover_calls_start ON ringover_calls(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_ringover_calls_contact ON ringover_calls(contact_number);

-- Cache des transcriptions + résumés IA
CREATE TABLE IF NOT EXISTS call_transcripts (
  cdr_id            bigint PRIMARY KEY REFERENCES ringover_calls(cdr_id) ON DELETE CASCADE,
  transcript_text   text,
  summary           text,
  extracted         jsonb,
  audio_duration_s  int,
  voxtral_model     text,
  summary_model     text,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE ringover_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON ringover_calls FOR ALL USING (true);
CREATE POLICY "Service role full access" ON call_transcripts FOR ALL USING (true);
