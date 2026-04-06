-- ============================================
-- CRM Menuiserie — Schema Supabase
-- ============================================

-- Clients (issus de Leboncoin ou autre)
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  telephone text,
  email text,
  adresse text,
  code_postal text,
  ville text,
  portal_token uuid UNIQUE DEFAULT gen_random_uuid(),
  source text DEFAULT 'leboncoin',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Devis
CREATE TABLE devis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  reference text NOT NULL,
  status text DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'envoye', 'lu', 'signe', 'refuse', 'expire')),
  lignes jsonb DEFAULT '[]'::jsonb,
  montant_ht numeric(10,2) DEFAULT 0,
  tva numeric(4,2) DEFAULT 20,
  montant_ttc numeric(10,2) DEFAULT 0,
  notes text,
  pdf_url text,
  sent_at timestamptz,
  read_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Signatures
CREATE TABLE signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devis_id uuid REFERENCES devis(id) ON DELETE CASCADE,
  signature_data text NOT NULL,
  signer_name text,
  signer_ip text,
  document_hash text NOT NULL,
  signed_at timestamptz DEFAULT now()
);

-- Templates de réponse Leboncoin
CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cas text UNIQUE NOT NULL,
  label text NOT NULL,
  contenu text NOT NULL,
  actif boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Historique des messages classifiés
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titre_annonce text,
  message_client text NOT NULL,
  has_attachment boolean DEFAULT false,
  classification jsonb,
  reponse_generee text,
  reponse_envoyee boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Séquence pour les références de devis (DEV-2026-001)
CREATE SEQUENCE devis_ref_seq START 1;

CREATE OR REPLACE FUNCTION generate_devis_reference()
RETURNS trigger AS $$
BEGIN
  NEW.reference := 'DEV-' || EXTRACT(YEAR FROM now()) || '-' || LPAD(nextval('devis_ref_seq')::text, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_devis_reference
  BEFORE INSERT ON devis
  FOR EACH ROW
  WHEN (NEW.reference IS NULL)
  EXECUTE FUNCTION generate_devis_reference();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_devis_updated_at
  BEFORE UPDATE ON devis FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_clients_telephone ON clients(telephone);
CREATE INDEX idx_clients_portal_token ON clients(portal_token);
CREATE INDEX idx_devis_client_id ON devis(client_id);
CREATE INDEX idx_devis_status ON devis(status);
CREATE INDEX idx_devis_reference ON devis(reference);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE devis ENABLE ROW LEVEL SECURITY;
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for service role" ON clients FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON devis FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON signatures FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON templates FOR ALL USING (true);
CREATE POLICY "Allow all for service role" ON messages FOR ALL USING (true);

INSERT INTO templates (cas, label, contenu) VALUES
('A', 'Aucune info — demander dimensions + tel', 'Bonjour, merci pour votre message !\n\nPourriez-vous m''indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !'),
('B', 'Produit seul — demander dimensions + tel', 'Bonjour, merci pour votre message !\n\nJe note votre projet de {produit}. Pourriez-vous m''indiquer les dimensions souhaitées ainsi que votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !'),
('C', 'Produit + dimensions — demander tel', 'Bonjour, merci pour votre message !\n\nJe note votre projet de {produit} {dimensions}. Pourriez-vous me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !'),
('D', 'Tout donné — confirmer', 'Bonjour, merci pour votre message !\n\nJe note votre projet de {produit} {dimensions}. Je vous prépare le devis et vous l''envoie par SMS.\n\nBonne journée !'),
('H', 'Refus téléphone — clore poliment', 'Bonjour, je comprends tout à fait ! Malheureusement je ne peux pas établir de devis sans numéro de téléphone — c''est indispensable pour vous envoyer le document et échanger si vous avez des questions.\n\nN''hésitez pas à revenir vers moi si vous changez d''avis !\n\nBonne journée !'),
('SYSTEM', 'Notification Leboncoin — inviter à envoyer', 'Bonjour, merci pour votre intérêt !\n\nN''hésitez pas à me préciser votre projet (type de menuiserie, dimensions souhaitées) ainsi que votre numéro de téléphone — je vous prépare un devis personnalisé et vous l''envoie directement par SMS.\n\nBonne journée !');
