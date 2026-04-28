-- ============================================
-- lbc_outbox : index unique partiel pour éviter double-fire
-- Migrations appliquées via MCP Supabase :
--   1. lbc_outbox_dedup_active_duplicates (one-shot dedup historique)
--   2. lbc_outbox_unique_active_per_conversation (création de l'index)
-- ============================================

-- Dedup historique (one-shot, déjà appliqué — gardé ici en référence) :
-- DELETE FROM lbc_outbox
-- WHERE id IN (
--   SELECT id FROM (
--     SELECT id,
--            ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY id ASC) AS rn
--     FROM lbc_outbox
--     WHERE status IN ('pending', 'sent')
--   ) sub
--   WHERE rn > 1
-- );

-- Empêche d'avoir 2 entrées actives pour la même conversation (anti-double auto-reply).
-- Les statuts 'error' restent libres (on peut retry si besoin).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lbc_outbox_conv_active
  ON lbc_outbox (conversation_id)
  WHERE status IN ('pending', 'sent');
