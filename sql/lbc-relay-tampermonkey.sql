-- ============================================
-- LBC Relay via Tampermonkey + Supabase
-- ============================================
-- Architecture:
--   Tampermonkey (Mac mini Chrome) ←→ Supabase ←→ CRM Vercel
--   Plus de relay VPS, plus de Hyper-SDK.
-- ============================================

-- =============================================
-- 1. Cache des messages LBC (lecture rapide depuis le CRM)
-- =============================================
CREATE TABLE IF NOT EXISTS lbc_messages (
  id text PRIMARY KEY,                          -- message_id LBC
  conversation_id text NOT NULL,
  text text,
  sender_id text,                               -- "me" si nous, sinon partner_id
  is_me boolean DEFAULT false,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  attachments jsonb DEFAULT '[]'::jsonb,        -- [{url, type, name}]
  raw jsonb,                                    -- payload brut LBC pour debug
  synced_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lbc_messages_conv ON lbc_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lbc_messages_unread ON lbc_messages(conversation_id) WHERE read_at IS NULL AND is_me = false;

-- =============================================
-- 2. Queue d'actions (envoi message, mark read, etc.)
--    Tampermonkey écoute via realtime → exécute → écrit la réponse
-- =============================================
CREATE TABLE IF NOT EXISTS lbc_actions_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL CHECK (action_type IN (
    'send_message',         -- POST /messages
    'mark_read',            -- PUT /messages/<id>/read
    'fetch_conversations',  -- GET /conversations (sync forcé)
    'fetch_messages',       -- GET /conversations/<id>/messages
    'fetch_unread'          -- GET /counter
  )),
  payload jsonb NOT NULL,                       -- {conv_id, text, ...}
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'done', 'error'
  )),
  response jsonb,                               -- réponse de Tampermonkey
  error_message text,
  http_status int,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lbc_actions_pending ON lbc_actions_queue(created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lbc_actions_status ON lbc_actions_queue(status, created_at DESC);

-- =============================================
-- 3. Token LBC (le Tampermonkey peut le rafraîchir et le pousser ici)
--    Optionnel mais utile pour debug
-- =============================================
CREATE TABLE IF NOT EXISTS lbc_session_state (
  id int PRIMARY KEY DEFAULT 1,                 -- toujours 1 (single row)
  user_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_heartbeat_at timestamptz,                -- mise à jour par Tampermonkey régulièrement
  CONSTRAINT lbc_session_state_singleton CHECK (id = 1)
);

INSERT INTO lbc_session_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 4. RLS — service role only (pour l'instant)
-- =============================================
ALTER TABLE lbc_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lbc_actions_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE lbc_session_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON lbc_messages FOR ALL USING (true);
CREATE POLICY "Service role full access" ON lbc_actions_queue FOR ALL USING (true);
CREATE POLICY "Service role full access" ON lbc_session_state FOR ALL USING (true);

-- =============================================
-- 5. Realtime pour les actions queue (Tampermonkey écoute)
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE lbc_actions_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE lbc_messages;

-- =============================================
-- 6. Helpers
-- =============================================

-- Marquer une action comme "processing" atomiquement (un seul Tampermonkey en cas de doublon)
CREATE OR REPLACE FUNCTION claim_lbc_action(action_id uuid)
RETURNS lbc_actions_queue AS $$
DECLARE
  result lbc_actions_queue;
BEGIN
  UPDATE lbc_actions_queue
  SET status = 'processing', processed_at = now()
  WHERE id = action_id AND status = 'pending'
  RETURNING * INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Compter unread total (pour le badge du CRM)
CREATE OR REPLACE FUNCTION lbc_total_unread()
RETURNS int AS $$
  SELECT COALESCE(SUM(unread_count), 0)::int FROM lbc_leads;
$$ LANGUAGE sql STABLE;
