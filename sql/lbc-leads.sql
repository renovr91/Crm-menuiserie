-- ============================================
-- LBC Leads — Suivi des conversations LBC
-- ============================================

-- Table principale des leads LBC
CREATE TABLE lbc_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text UNIQUE NOT NULL,
  contact_name text NOT NULL DEFAULT 'Inconnu',
  ad_id text,
  ad_title text,
  ad_price text,
  city text,
  zip_code text,
  departement text,
  statut text DEFAULT 'nouveau' CHECK (statut IN (
    'nouveau', 'repondu', 'devis_envoye', 'en_attente', 'relance', 'gagne', 'perdu'
  )),
  client_id uuid REFERENCES clients(id),
  notes text,
  telephone text,
  dernier_message text,
  dernier_message_date timestamptz,
  dernier_message_is_me boolean DEFAULT false,
  classification jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Historique des changements de statut
CREATE TABLE lbc_lead_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES lbc_leads(id) ON DELETE CASCADE,
  old_statut text,
  new_statut text NOT NULL,
  note text,
  created_at timestamptz DEFAULT now()
);

-- Index
CREATE INDEX idx_lbc_leads_conversation_id ON lbc_leads(conversation_id);
CREATE INDEX idx_lbc_leads_statut ON lbc_leads(statut);
CREATE INDEX idx_lbc_leads_departement ON lbc_leads(departement);
CREATE INDEX idx_lbc_leads_updated_at ON lbc_leads(updated_at DESC);
CREATE INDEX idx_lbc_lead_history_lead_id ON lbc_lead_history(lead_id);

-- RLS
ALTER TABLE lbc_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lbc_lead_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON lbc_leads FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON lbc_lead_history FOR ALL USING (true);

-- Trigger updated_at (réutilise la fonction existante)
CREATE TRIGGER update_lbc_leads_updated_at
  BEFORE UPDATE ON lbc_leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
