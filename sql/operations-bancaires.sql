-- Opérations bancaires rapatriées (CIC via Enable Banking, Qonto…).
--
-- POURQUOI : le pointage se fait aujourd'hui à la main dans Filbanque. L'objet
-- de cette table est de mettre les mouvements sous les yeux, à côté de ce qui
-- attend un règlement, pour rapprocher en un clic.
--
-- CE QU'ELLE N'EST PAS : une comptabilité. Elle ne remplace ni `factures` ni
-- `facture_paiements` — quand on pointe, c'est la RPC `facture_saisir_paiement`
-- qui enregistre, comme aujourd'hui. Ici on ne garde que le lien.

create table if not exists operations_bancaires (
  id            bigserial primary key,

  -- `cic` | `qonto`. On ne fige pas une banque : le jour où l'une change,
  -- l'écran de pointage ne bouge pas.
  source        text not null,

  -- Identifiant fourni par la banque. Quand elle n'en donne pas — c'est le cas
  -- de plusieurs opérations CIC — l'adaptateur fabrique une clé composite
  -- (date + montant + libellé). D'où l'unicité sur (source, ref_externe).
  ref_externe   text not null,

  date_operation date not null,
  libelle        text not null,
  -- Signé : positif = encaissement, négatif = décaissement.
  montant        numeric(12,2) not null,

  -- ⚠️ `false` = opération PROVISOIRE (statut PDNG côté banque). Une provision
  -- de remise de chèque en attente sera ANNULÉE : la rapprocher créerait un
  -- faux encaissement. L'écran ne doit proposer au pointage que le définitif.
  definitive    boolean not null default true,
  statut_banque text,

  -- Le pointage. Nul tant que l'opération n'est rattachée à rien.
  pointee_le    timestamptz,
  pointee_par   text,
  facture_id    uuid references factures(id) on delete set null,
  devis_numero  text,
  -- Permet d'écarter une opération sans la rattacher : frais bancaires,
  -- mouvement interne, virement personnel. Sinon elle resterait à l'écran
  -- indéfiniment et on finirait par ne plus regarder l'écran du tout.
  ignoree_le    timestamptz,
  note          text,

  vue_le        timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  unique (source, ref_externe)
);

create index if not exists operations_bancaires_a_pointer_idx
  on operations_bancaires (date_operation desc)
  where pointee_le is null and ignoree_le is null;
create index if not exists operations_bancaires_montant_idx
  on operations_bancaires (montant);

comment on table operations_bancaires is
  'Mouvements bancaires rapatriés, pour le pointage assisté. Pas une comptabilité.';
comment on column operations_bancaires.definitive is
  'false = provisoire (PDNG) : ne jamais proposer au pointage, sera annulé.';
