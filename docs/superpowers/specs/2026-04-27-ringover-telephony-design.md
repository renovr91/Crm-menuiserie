# Intégration Téléphonie Ringover — Design

**Date** : 2026-04-27
**Statut** : design validé, prêt pour implémentation
**Repo** : `Crm-menuiserie`

## 1. Contexte & objectif

Le CRM Renov-R intègre déjà la messagerie LBC, le pipeline clients, les devis, etc.
On ajoute un onglet **Téléphonie** qui permet de :

- Voir l'historique des appels Ringover
- Écouter les enregistrements
- Générer un résumé IA d'un appel (transcription + extraction structurée)
- Convertir un appel en affaire dans le pipeline (avec auto-link client si tel matche)

**Compte Ringover** : Yacine Senane (RENOV-R) — `user_id=24321190`, `team_id=18311689`.
**API key Ringover** : à mettre dans `RINGOVER_API_KEY` côté Vercel (env var).
**API key Mistral** : à mettre dans `MISTRAL_API_KEY` côté Vercel (env var).

## 2. Architecture

```
CRM (Vercel)                  Supabase                    Mistral API
──────────                    ────────                    ───────────
/telephonie page  ←───→  ringover_calls (cache)
                  ←───→  call_transcripts
   ↓ (clic Refresh)
/api/ringover/sync       →  fetch Ringover API
                            └→ upsert ringover_calls

   ↓ (clic 🎤 Résumer)
/api/ringover/transcribe →  download record_url
                            └→ POST Voxtral /v1/audio/transcriptions
                                  └→ POST Mistral Small /v1/chat/completions
                                        └→ upsert call_transcripts
                                            (transcript + summary + extracted JSON)

   ↓ (clic 📋 Créer affaire)
/api/ringover/to-affaire →  match phone → clients / lbc_leads / new
                            └→ INSERT/UPDATE clients
                                INSERT affaires
                                INSERT activites (type='appel')
```

## 3. Modèle de données

### Tables nouvelles

```sql
-- Cache des appels Ringover (synchronisé depuis l'API)
CREATE TABLE ringover_calls (
  cdr_id              bigint PRIMARY KEY,        -- id unique Ringover
  call_id             text NOT NULL,             -- call_id Ringover
  direction           text NOT NULL CHECK (direction IN ('in', 'out')),
  type                text,                      -- 'PHONE', 'IVR', etc.
  last_state          text,                      -- 'ANSWERED', 'MISSED', etc.
  is_answered         boolean DEFAULT false,
  start_time          timestamptz NOT NULL,
  answered_time       timestamptz,
  end_time            timestamptz,
  total_duration      int,                       -- secondes
  incall_duration     int,                       -- secondes (durée parlée)
  from_number         text NOT NULL,
  to_number           text NOT NULL,
  contact_number      text,                      -- numéro du contact (in: from, out: to)
  record_url          text,                      -- URL de l'enregistrement audio
  ringover_user_id    bigint,                    -- user qui a pris l'appel
  ringover_user_email text,
  raw                 jsonb,                     -- payload brut Ringover
  synced_at           timestamptz DEFAULT now()
);

CREATE INDEX idx_ringover_calls_start ON ringover_calls(start_time DESC);
CREATE INDEX idx_ringover_calls_contact ON ringover_calls(contact_number);

-- Cache des transcriptions + résumés
CREATE TABLE call_transcripts (
  cdr_id            bigint PRIMARY KEY REFERENCES ringover_calls(cdr_id) ON DELETE CASCADE,
  transcript_text   text,                        -- transcription complète Voxtral
  summary           text,                        -- résumé court (2-3 phrases)
  extracted         jsonb,                       -- JSON structuré (name, city, product, etc.)
  audio_duration_s  int,                         -- pour facturer
  voxtral_model     text,                        -- ex: 'voxtral-mini-2507'
  summary_model     text,                        -- ex: 'mistral-small-latest'
  created_at        timestamptz DEFAULT now()
);
```

### Tables existantes utilisées (lecture / écriture)

- `clients` : matching par `telephone`, INSERT/UPDATE
- `lbc_leads` : matching par `telephone`, lecture seule (mais on peut UPDATE `client_id` après création)
- `affaires` : INSERT (titre, client_id, pipeline_stage='nouveau', montant_estime, commercial_id, description)
- `activites` : INSERT (type='appel', client_id, commercial_id, contenu=résumé, date_faite=start_time, fait=true)
- `commerciaux` : matching par `email` pour identifier qui a pris l'appel

### Format `extracted` JSON

```json
{
  "name": "Jean Dupont",
  "city": "Évry-Courcouronnes",
  "zip_code": "91000",
  "phone": "0673716765",
  "email": null,
  "product_type": "fenetre",
  "quantity": 3,
  "estimated_amount": null,
  "urgency": "moyen",
  "next_action": "Devis cette semaine + visite jeudi"
}
```

## 4. Composants

### 4.1 Frontend

**Fichier** : `app/(admin)/telephonie/page.tsx` (nouveau)

- Tableau des appels (date desc, contact, direction icône, durée, status pill)
- Filtres : période (today/week/month), direction, missed/answered
- Pour chaque ligne :
  - Player audio HTML5 (`<audio src={record_url} controls />`) si `record_url`
  - Bouton **🎤 Résumer** (loader pendant traitement)
  - Bouton **📋 Créer affaire**
  - Si déjà résumé : badge avec résumé, expand pour voir transcript complet + extracted
- Modal "Créer affaire" pré-rempli (cf. section 4.4)
- Bouton **🔄 Refresh** en haut → POST /api/ringover/sync

Ajouter `{ href: '/telephonie', label: 'Téléphonie', icon: '📞' }` dans `NAV_ITEMS` de `app/(admin)/layout.tsx`.

### 4.2 API routes

#### `app/api/ringover/sync/route.ts` (POST)

```ts
// Fetch les X derniers appels Ringover (default 100), upsert dans ringover_calls.
// Body optionnel: { since: ISO date, limit: number }
// Retour: { synced: number, new: number, updated: number }
```

#### `app/api/ringover/calls/route.ts` (GET)

```ts
// Liste les appels en base (lecture Supabase, pas Ringover).
// Query: ?period=today|week|month, ?direction=in|out, ?missed=true
// Retour: { calls: [{...ringover_call, transcript: {...} | null}] }
// JOIN sur call_transcripts pour avoir le résumé inline.
```

#### `app/api/ringover/transcribe/route.ts` (POST)

```ts
// Body: { cdr_id }
// 1. Lit ringover_calls (s'assure que record_url existe)
// 2. Si call_transcripts existe déjà → retourne le cache
// 3. Sinon :
//    a. Download record_url (avec Authorization: API_KEY Ringover si nécessaire)
//    b. POST Mistral Voxtral /v1/audio/transcriptions (multipart/form-data)
//    c. POST Mistral Small /v1/chat/completions avec prompt extraction
//    d. Parse JSON output
//    e. INSERT call_transcripts
// Retour: { transcript, summary, extracted }
```

#### `app/api/ringover/to-affaire/route.ts` (GET puis POST)

**GET** `?cdr_id=X` : retourne le mode de matching et le suggéré
```ts
// 1. Lit ringover_calls + call_transcripts (transcript optionnel)
// 2. Détermine contact_number (selon direction)
// 3. Match clients.telephone → return { mode: 'existing', client, suggested }
// 4. Sinon match lbc_leads.telephone → return { mode: 'from_lead', lead, suggested }
// 5. Sinon → return { mode: 'new', suggested }
// suggested = { name, city, zip_code, email, product_type, montant, titre, description }
```

**POST** : crée l'affaire avec le form validé
```ts
// Body: { cdr_id, mode, client_data, affaire_data }
// 1. Selon mode:
//    - existing : UPDATE clients si fields manquants + INSERT affaire + INSERT activite
//    - from_lead : INSERT clients (depuis lead) + UPDATE lbc_leads.client_id + INSERT affaire + activite
//    - new : INSERT clients + INSERT affaire + INSERT activite
// 2. Logger dans activity_log (action_type='ringover_to_affaire')
// Retour: { affaire_id, client_id }
```

### 4.3 Lib

**`lib/ringover.ts`** (nouveau)
```ts
// listCalls(opts), downloadRecord(url), normalizePhone(num)
// La clé API est lue depuis process.env.RINGOVER_API_KEY
```

**`lib/mistral.ts`** (nouveau)
```ts
// transcribeAudio(audioBuffer): { text, duration_s, model }
// summarizeAndExtract(transcript): { summary, extracted, model }
// Utilise process.env.MISTRAL_API_KEY
```

### 4.4 Modal "Créer affaire"

Composant : `app/(admin)/telephonie/CreateAffaireModal.tsx`

Champs pré-remplis selon mode (existing / from_lead / new) :

| Champ | Source pré-remplissage |
|---|---|
| Nom client | `extracted.name` ou `client.nom` ou `lead.contact_name` |
| Téléphone | `contact_number` normalisé (0xxx) |
| Email | `extracted.email` ou `client.email` ou `lead.email` |
| Ville | `extracted.city` ou `client.ville` |
| Code postal | `extracted.zip_code` ou `client.code_postal` |
| Adresse | `client.adresse` |
| Titre affaire | `"Appel ${date} - ${product_type}"` |
| Description | `summary` IA |
| Produit (besoin) | `extracted.product_type` |
| Montant estimé | `extracted.estimated_amount` parsé en numeric (cf. règle ci-dessous) |
| Pipeline stage | "nouveau" (default) |
| Commercial | Auto via `ringover.user.email` ↔ `commerciaux.email`, fallback user actuel |

Header du modal indique le mode :
- 🟢 "Client existant — Yacine Senane" (si match)
- 🔵 "Lead LBC trouvé — Imad" (si lead match)
- 🆕 "Nouveau client" (si rien)

**Règle de parsing du montant** :
Mistral peut renvoyer `estimated_amount` dans plusieurs formats (`"3000€"`, `"3000-5000€"`, `"environ 4000"`, `null`). Règle :
- Si nombre seul → cast direct
- Si fourchette `"X-Y€"` → prendre la moyenne (X+Y)/2
- Si "environ X" / "vers X" → cast X
- Si non parseable → laisser le champ vide (l'user remplit)
- Stocké en `numeric` dans `affaires.montant_estime`

## 5. Flux utilisateur (happy path)

1. Yacine reçoit un appel sur son numéro pro Ringover, parle 5 min, raccroche
2. Plus tard, Yacine ouvre le CRM → onglet **Téléphonie**
3. Page liste les derniers appels (chargés depuis Supabase, sync auto à l'ouverture)
4. Yacine voit l'appel récent, clique **🎤 Résumer**
5. Loader pendant ~10 secondes (download + transcription Voxtral + résumé Mistral Small)
6. Apparaît sous l'appel : résumé "Le client cherche 3 fenêtres PVC à Évry, devis cette semaine"
7. Yacine clique **📋 Créer affaire**
8. Modal s'ouvre avec tout pré-rempli (nom Jean Dupont, ville Évry, produit fenêtre, montant null, etc.)
9. Yacine ajuste si nécessaire (ajoute montant 4000€, change commercial), valide
10. Le système crée :
    - `clients` (Jean Dupont, tel, ville)
    - `affaires` (titre "Appel 27/04 - Fenêtre PVC", pipeline_stage='nouveau', montant 4000)
    - `activites` (type='appel', date_faite=start_time, contenu=résumé)
11. Toast "Affaire créée" avec lien vers la fiche client

## 6. Gestion d'erreurs

| Erreur | Comportement |
|---|---|
| Ringover API 4xx/5xx sur sync | Affiche toast erreur, pas de crash |
| `record_url` absent (appel < 10s ou non enregistré) | Désactiver le bouton "Résumer" + tooltip |
| Voxtral fail (audio corrompu, timeout) | Toast "Transcription échouée", log dans Supabase, ne PAS sauvegarder partial |
| Mistral Small fail (JSON invalide) | Sauvegarde transcript brut + summary vide, l'user peut résumer manuellement |
| Match phone ambigu (plusieurs clients) | Modal liste les candidats, user choisit |
| Insert affaire fail (RLS, constraints) | Rollback, toast détaillé |

## 7. Variables d'environnement Vercel

À ajouter dans Vercel Project Settings (et `.env.local` en dev) :

```
RINGOVER_API_KEY=<à récupérer dans le dashboard Ringover>
MISTRAL_API_KEY=<à récupérer dans console.mistral.ai>
RINGOVER_USER_ID=24321190
LBC_USER_ID=45b4d579-2ede-4a25-b889-280ffd926393  # si pas déjà existant
```

⚠️ **Les clés API ne doivent JAMAIS être commitées dans le repo.** Elles sont uniquement dans l'env Vercel + un `.env.local` local non versionné (déjà dans `.gitignore`).

## 8. Sécurité

- Toutes les routes API exigent une session authentifiée Supabase (utilisateur connecté CRM)
- Pas d'exposition des clés API au client (server-side only)
- Les `record_url` Ringover peuvent contenir des tokens d'accès → on télécharge côté serveur, on ne propage pas à l'iframe client
- L'audio peut être streamé via une route proxy si besoin de cache, sinon lien direct Ringover (le navigateur du commercial est authentifié)

## 9. Coûts estimés (Mistral)

| Volume hypothétique | Voxtral | Mistral Small | Total/mois |
|---|---|---|---|
| 5 appels/jour × 5 min | $0.01 | $0.02 | **~$0.05** |
| 20 appels/jour × 5 min | $0.04 | $0.06 | **~$0.20** |
| 100 appels/jour × 5 min | $0.20 | $0.30 | **~$1** |

Coût négligeable même au plan payant.

## 10. Hors-scope (V2 ou plus tard)

- Webhook Ringover temps-réel (pour notif "nouvel appel" sans refresh)
- Click-to-call depuis le CRM (déclencher un appel Ringover via API)
- Stats commerciaux (nb appels, durée moyenne, taux de décroché)
- Recherche full-text dans les transcriptions
- Tags / catégorisation auto des appels (chaud, froid, à rappeler, etc.)

## 11. Plan de migration

Aucune migration de données existantes nécessaire. On crée juste les 2 nouvelles tables Supabase.
La page `/telephonie` apparaît dans la nav, vide au début, se remplit dès le 1er sync.

## 12. Critères de succès

- L'utilisateur ouvre `/telephonie` et voit l'historique des appels du compte Ringover
- L'utilisateur clique "Résumer" sur un appel et obtient un résumé pertinent en français en moins de 15 secondes
- L'utilisateur clique "Créer affaire" et le modal est pré-rempli avec les infos extraites
- L'affaire créée apparaît dans le pipeline existant
- L'activité d'appel apparaît dans la timeline du client
- Coût Mistral < $1/mois en usage normal
