-- =====================================================================
-- LBC — Tri automatique des leads (règles, sans IA)
-- =====================================================================
-- À chaque écriture du fil de messages (lbc_messages), on analyse les
-- messages ENTRANTS du client (outgoing = false) et on déplace le lead :
--   • dimensions détectées            -> devis_a_traiter
--   • vrai message (sans dimensions)  -> a_repondre
--   • uniquement du bruit LBC / vide  -> on ne touche à rien
--
-- Déplacements MONTANTS uniquement (jamais de retour en arrière, jamais
-- un lead déjà avancé) :
--   nouveau      -> a_repondre | devis_a_traiter
--   a_repondre   -> devis_a_traiter   (le client a fini par donner ses dims)
--   repondu      -> devis_a_traiter   (idem, on ne le repasse PAS en a_repondre)
-- Chaque déplacement est tracé dans lbc_lead_history.
-- =====================================================================

-- 1) Autoriser le nouveau statut 'a_repondre'
ALTER TABLE public.lbc_leads DROP CONSTRAINT IF EXISTS lbc_leads_statut_check;
ALTER TABLE public.lbc_leads ADD CONSTRAINT lbc_leads_statut_check
  CHECK (statut = ANY (ARRAY[
    'nouveau','a_repondre','repondu','devis_a_traiter','devis_envoye',
    'relance_1','relance_2','relance','en_attente','gagne','perdu','pas_interesse'
  ]::text[]));

-- 2) Fonction de tri
CREATE OR REPLACE FUNCTION public.fn_lbc_auto_triage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_dims    boolean := false;
  v_has_genuine boolean := false;
  v_lead        record;
  v_target      text;
BEGIN
  -- Analyse des messages ENTRANTS (outgoing = false)
  SELECT
    bool_or(
      t.text ~* '(\d+\s*[a-zéè]{0,3}\s*[x×*]\s*\d+)|(\d+\s*(par|sur)\s+\d+)|(\d+\s*m\s*\d{2})|(\d+([.,]\d+)?\s*(cm|mm|centim|millim|m2|m²))|(\d+([.,]\d+)?\s*m\M)|(\d+([.,]\d+)?\s*(mètre|metre))|((largeur|larg|hauteur|haut|longueur|long|profondeur|prof|dimension|mesure|côté|cote)\w*\D{0,8}\d)|(\y[lh]\s*[:=]\s*\d+)'
    ),
    bool_or(
      length(coalesce(t.text,'')) > 0
      -- pas seulement un message-type / système Leboncoin
      AND btrim(t.text) !~* '^(coucou|bonjour|bonsoir|bjr|hello|slt|salut)?([[:space:],!?:.;()''-]*((votre annonce m.{0,3}int[ée]resse)|(est.?elle (encore |toujours )?disponible)|(votre bien est toujours disponible)|(faites.?le lui savoir)|(toujours dispo\w*)|(ici nous garantissons[^$]*)|(vous avez un message de .*en attente[^$]*)|(celui-ci ne pourra plus[^$]*)))+[[:space:],!?:.;()''-]*$'
      -- pas seulement une politesse / accusé de réception
      AND btrim(t.text) !~* '^((ok|okay|oui|non|merci|d.?accord|super|parfait|nickel|noté|bonjour|bonsoir|bjr|coucou|salut|slt|bien|reçu|recu|marche|ca|ça|tres|très|beaucoup)[[:space:]!.,]*)+$'
      -- pas un simple ping de disponibilité
      AND NOT (length(t.text) <= 32 AND t.text ~* 'dispo')
    )
  INTO v_has_dims, v_has_genuine
  FROM (
    SELECT btrim(msg->>'text') AS text
    FROM jsonb_array_elements(NEW.messages) AS msg
    WHERE (msg->>'outgoing')::boolean IS FALSE
  ) t;

  -- Route cible
  IF v_has_dims THEN
    v_target := 'devis_a_traiter';
  ELSIF v_has_genuine THEN
    v_target := 'a_repondre';
  ELSE
    RETURN NEW;  -- que du bruit -> rien
  END IF;

  -- Statut courant du lead
  SELECT id, statut INTO v_lead
  FROM public.lbc_leads
  WHERE conversation_id = NEW.conversation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Déplacements montants uniquement
  IF v_target = 'devis_a_traiter'
     AND v_lead.statut IN ('nouveau','a_repondre','repondu') THEN
    UPDATE public.lbc_leads SET statut = 'devis_a_traiter', updated_at = now()
    WHERE id = v_lead.id;
    INSERT INTO public.lbc_lead_history (lead_id, old_statut, new_statut, note)
    VALUES (v_lead.id, v_lead.statut, 'devis_a_traiter', 'auto-tri: dimensions détectées');

  ELSIF v_target = 'a_repondre'
     AND v_lead.statut = 'nouveau' THEN
    UPDATE public.lbc_leads SET statut = 'a_repondre', updated_at = now()
    WHERE id = v_lead.id;
    INSERT INTO public.lbc_lead_history (lead_id, old_statut, new_statut, note)
    VALUES (v_lead.id, v_lead.statut, 'a_repondre', 'auto-tri: message client à traiter');
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Déclencheur : à chaque écriture du fil de messages
DROP TRIGGER IF EXISTS trg_lbc_auto_triage ON public.lbc_messages;
CREATE TRIGGER trg_lbc_auto_triage
AFTER INSERT OR UPDATE OF messages ON public.lbc_messages
FOR EACH ROW
EXECUTE FUNCTION public.fn_lbc_auto_triage();
