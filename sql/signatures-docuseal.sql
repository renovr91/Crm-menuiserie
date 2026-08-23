-- Signature électronique DocuSeal : on ÉTEND la table `signatures` existante
-- plutôt que d'en créer une seconde. Un seul endroit où chercher une preuve.
--
-- POURQUOI RAPATRIER : la preuve ne vaut que si on peut la PRODUIRE des années
-- plus tard. Les dossiers perdus en 2025 le sont parce que le fichier de preuve
-- n'est pas produit, illisible, ou ne se rattache à rien. Un lien DocuSeal ne
-- survit pas à un changement d'abonnement.
--
-- ⚠️ RGPD : `signer_ip` conserve des adresses IP de particuliers pendant 10 ans
-- (durée de la décennale). Base légale et durée à inscrire dans la politique
-- de confidentialité.

-- signature_data devient facultatif : chez DocuSeal l'image de la signature
-- vit dans le document scellé, pas chez nous.
alter table signatures alter column signature_data drop not null;
alter table signatures alter column document_hash  drop not null;

alter table signatures add column if not exists numero            text;
alter table signatures add column if not exists source            text default 'maison';
alter table signatures add column if not exists submission_id     bigint;
alter table signatures add column if not exists verification      text;
alter table signatures add column if not exists pdf_signe_path    text;
alter table signatures add column if not exists certificat_path   text;
alter table signatures add column if not exists evenements        jsonb;

-- Idempotence du cron : une soumission ne peut être archivée qu'une fois.
create unique index if not exists signatures_submission_id_uniq
  on signatures (submission_id) where submission_id is not null;
create index if not exists signatures_numero_idx on signatures (numero);

comment on column signatures.numero is
  'Référence Renov-R (DC-xxxxx) : le lien entre le journal d''audit et le contrat.';
comment on column signatures.source is
  'maison = parcours /d/[token] avec code SMS OVH ; docuseal = prestataire externe.';
comment on column signatures.document_hash is
  'SHA-256 du PDF signé. Prouve qu''un document produit est bien celui signé.';
