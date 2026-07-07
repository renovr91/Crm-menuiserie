-- Historique des appels téléphoniques (Zadarma) + enregistrement, transcription, résumé IA
-- À exécuter dans Supabase (SQL editor) une seule fois.

CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pbx_call_id text UNIQUE,                 -- identifiant unique Zadarma (dédup)
  call_id_with_rec text,                   -- id pour récupérer l'enregistrement
  direction text CHECK (direction IN ('in', 'out', 'internal')),
  caller text,                             -- numéro appelant
  callee text,                             -- numéro / DID appelé
  extension text,                          -- poste interne concerné (101/102/103)
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  started_at timestamptz,
  duration integer DEFAULT 0,              -- durée en secondes
  disposition text,                        -- answered / no answer / busy / failed / cancel
  is_recorded boolean DEFAULT false,
  recording_url text,                      -- URL audio (Supabase Storage)
  transcript text,                         -- transcription exacte (Voxtral)
  summary text,                            -- résumé IA (Mistral)
  status text DEFAULT 'new' CHECK (status IN ('new', 'processing', 'done', 'error')),
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_started_at_idx ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS calls_client_id_idx ON calls (client_id);

-- Bucket de stockage pour les enregistrements audio (privé)
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;
