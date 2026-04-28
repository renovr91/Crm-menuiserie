# Auto-reply LBC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-réponse automatique au premier message LBC contenant *« toujours disponible »*, via un endpoint Next.js qui insère dans `lbc_outbox` ; envoi piloté par le Chrome Bridge existant.

**Architecture:** Le Chrome Bridge (Mac mini) ping un endpoint Vercel après chaque upsert `lbc_messages`. L'endpoint applique 3 garde-fous (toggle env, premier message + substring, anti-double-fire via index unique) et insère dans `lbc_outbox`. Le bridge envoie ensuite via la UI LBC (logique existante).

**Tech Stack:** Next.js 16 App Router (TypeScript strict), Supabase (cloud), PostgreSQL unique partial index, Tampermonkey user-script.

**Spec source:** `docs/superpowers/specs/2026-04-28-lbc-auto-reply-design.md`

---

## File Structure

**Nouveaux fichiers :**
- `sql/lbc-outbox-unique-index.sql` — DDL de référence (migration appliquée via MCP)
- `app/api/lbc-messaging/auto-reply-check/route.ts` — endpoint POST auth-by-token

**Modifiés :**
- `middleware.ts` — ajouter `/api/lbc-messaging/auto-reply-check` à `PUBLIC_PATHS`
- `.gitignore` — ajouter `lbc_chrome_bridge.user.js` (sécurité : éviter de commit le bridge avec le secret en clair)
- `lbc_chrome_bridge.user.js` (UNIQUEMENT en local sur le Mac mini, **pas commit**) — ajout d'un fetch fire-and-forget après l'upsert `lbc_messages`

**Variables d'environnement à ajouter (Vercel + `.env.local`) :**
```
LBC_AUTO_REPLY_ENABLED=true
LBC_AUTO_REPLY_SECRET=<random hex 64 chars>
LBC_AUTO_REPLY_TEXT=Bonjour, merci pour votre message !\n\nPourriez-vous m'indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !
```

---

## Task 1 : Migration SQL — index unique partial sur `lbc_outbox`

**Files:**
- Create: `sql/lbc-outbox-unique-index.sql`
- Apply: via Supabase MCP migration `lbc_outbox_unique_active_per_conversation`

- [ ] **Step 1 : Écrire le DDL de référence**

Crée `sql/lbc-outbox-unique-index.sql` :

```sql
-- ============================================
-- lbc_outbox : index unique partiel pour éviter double-fire
-- Applied via MCP Supabase migration: lbc_outbox_unique_active_per_conversation
-- ============================================

-- Empêche d'avoir 2 entrées actives pour la même conversation (anti-double auto-reply).
-- Les statuts 'error' restent libres (on peut retry si besoin).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lbc_outbox_conv_active
  ON lbc_outbox (conversation_id)
  WHERE status IN ('pending', 'sent');
```

- [ ] **Step 2 : Appliquer la migration via MCP Supabase**

Utiliser le tool `mcp__4182fad8-...__apply_migration` avec :
- `project_id` : `ijdbfhwkwxpcxfmiwgad`
- `name` : `lbc_outbox_unique_active_per_conversation`
- `query` : le contenu DDL ci-dessus

- [ ] **Step 3 : Vérifier que l'index est bien créé**

Utiliser `mcp__4182fad8-...__execute_sql` avec :
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename='lbc_outbox' AND indexname='idx_lbc_outbox_conv_active';
```
Expected : 1 ligne, indexdef contient `WHERE (status = ANY (ARRAY['pending'::text, 'sent'::text]))`.

- [ ] **Step 4 : Tester le comportement de l'index**

Via `execute_sql`, vérifier qu'on ne peut pas insérer 2 lignes pending pour la même conv :

```sql
-- Ces 3 commandes doivent être exécutées en SQL transactionnel :
INSERT INTO lbc_outbox (conversation_id, text, status) VALUES ('test-unique-idx', 'msg1', 'pending');
-- La ligne suivante doit FAILER avec une violation d'index unique :
INSERT INTO lbc_outbox (conversation_id, text, status) VALUES ('test-unique-idx', 'msg2', 'pending');
-- Cleanup :
DELETE FROM lbc_outbox WHERE conversation_id='test-unique-idx';
```
Expected : la 2e INSERT renvoie `duplicate key value violates unique constraint "idx_lbc_outbox_conv_active"`.

Note : si l'agent ne peut pas runner du SQL en mode transactionnel via MCP, c'est OK de skipper Step 4 et de valider à la place via le test E2E à Task 9.

- [ ] **Step 5 : Commit le DDL de référence**

```bash
cd /Users/elpatroneee/Crm-menuiserie
git add sql/lbc-outbox-unique-index.sql
git commit -m "feat(lbc): unique partial index on lbc_outbox for anti-double-fire

Empêche 2 entrées actives (pending|sent) pour la même conversation_id.
Migration déjà appliquée via MCP : lbc_outbox_unique_active_per_conversation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 : Route API `/api/lbc-messaging/auto-reply-check`

**Files:**
- Create: `app/api/lbc-messaging/auto-reply-check/route.ts`

- [ ] **Step 1 : Créer le dossier et le fichier**

```bash
mkdir -p /Users/elpatroneee/Crm-menuiserie/app/api/lbc-messaging/auto-reply-check
```

- [ ] **Step 2 : Écrire le code complet de la route**

Créer `app/api/lbc-messaging/auto-reply-check/route.ts` :

```typescript
/**
 * POST /api/lbc-messaging/auto-reply-check
 *
 * Appelé par le Chrome Bridge après un upsert lbc_messages.
 * Vérifie 3 garde-fous puis insère une auto-réponse dans lbc_outbox.
 *
 * Auth : header `Authorization: Bearer <LBC_AUTO_REPLY_SECRET>`.
 * Cet endpoint est ajouté à PUBLIC_PATHS du middleware (pas d'auth user Supabase).
 *
 * Body : { conversation_id: string }
 * Return : { triggered: boolean, reason: 'ok' | 'disabled' | 'not_found' | 'not_first_msg' | 'no_match' | 'already_replied' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const TRIGGER_SUBSTRING = 'toujours disponible'

interface LbcMessage {
  text?: string
  isMe?: boolean
  is_me?: boolean
  [key: string]: unknown
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  // 1. Auth bearer token
  const expected = process.env.LBC_AUTO_REPLY_SECRET
  if (!expected) {
    console.error('[auto-reply] LBC_AUTO_REPLY_SECRET not set')
    return unauthorized()
  }
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${expected}`) {
    return unauthorized()
  }

  // 2. Parse body
  let body: { conversation_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const conversation_id = typeof body.conversation_id === 'string' ? body.conversation_id : ''
  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
  }

  // 3. Kill switch
  if (process.env.LBC_AUTO_REPLY_ENABLED !== 'true') {
    console.log(`[auto-reply] conv=${conversation_id} reason=disabled`)
    return NextResponse.json({ triggered: false, reason: 'disabled' })
  }

  const sb = createAdminClient()

  try {
    // 4. Charger la conversation
    const { data: row, error: selErr } = await sb
      .from('lbc_messages')
      .select('messages')
      .eq('conversation_id', conversation_id)
      .maybeSingle()

    if (selErr) {
      console.error('[auto-reply] select lbc_messages error:', selErr.message)
      return NextResponse.json({ error: selErr.message }, { status: 500 })
    }

    if (!row) {
      console.log(`[auto-reply] conv=${conversation_id} reason=not_found`)
      return NextResponse.json({ triggered: false, reason: 'not_found' })
    }

    const messages = (row.messages || []) as LbcMessage[]

    // 5. Garde-fou : doit être un seul message envoyé par l'acheteur
    if (messages.length !== 1) {
      console.log(
        `[auto-reply] conv=${conversation_id} reason=not_first_msg (length=${messages.length})`,
      )
      return NextResponse.json({ triggered: false, reason: 'not_first_msg' })
    }
    const m = messages[0]
    const isMe = m.isMe === true || m.is_me === true
    if (isMe) {
      console.log(`[auto-reply] conv=${conversation_id} reason=not_first_msg (is_me)`)
      return NextResponse.json({ triggered: false, reason: 'not_first_msg' })
    }

    // 6. Garde-fou : pattern substring
    const text = (m.text || '').toLowerCase().trim()
    if (!text.includes(TRIGGER_SUBSTRING)) {
      console.log(`[auto-reply] conv=${conversation_id} reason=no_match`)
      return NextResponse.json({ triggered: false, reason: 'no_match' })
    }

    // 7. Garde-fou : déjà une entrée outbox active ?
    const { count, error: cntErr } = await sb
      .from('lbc_outbox')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversation_id)
    if (cntErr) {
      console.error('[auto-reply] count outbox error:', cntErr.message)
      return NextResponse.json({ error: cntErr.message }, { status: 500 })
    }
    if ((count ?? 0) > 0) {
      console.log(`[auto-reply] conv=${conversation_id} reason=already_replied`)
      return NextResponse.json({ triggered: false, reason: 'already_replied' })
    }

    // 8. INSERT auto-reply
    const replyText =
      process.env.LBC_AUTO_REPLY_TEXT ||
      `Bonjour, merci pour votre message !\n\nPourriez-vous m'indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !`

    const { error: insErr } = await sb.from('lbc_outbox').insert({
      conversation_id,
      text: replyText,
      status: 'pending',
    })
    if (insErr) {
      // Si l'index unique a empêché un double-fire, on retourne already_replied proprement
      if (insErr.code === '23505') {
        console.log(`[auto-reply] conv=${conversation_id} reason=already_replied (race)`)
        return NextResponse.json({ triggered: false, reason: 'already_replied' })
      }
      console.error('[auto-reply] insert outbox error:', insErr.message)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    console.log(`[auto-reply] conv=${conversation_id} reason=ok text-len=${replyText.length}`)
    return NextResponse.json({ triggered: true, reason: 'ok' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    console.error('[auto-reply] unexpected error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 3 : TypeScript compile check**

```bash
cd /Users/elpatroneee/Crm-menuiserie
npx tsc --noEmit
```
Expected : aucune erreur (output vide).

- [ ] **Step 4 : Commit**

```bash
cd /Users/elpatroneee/Crm-menuiserie
git add app/api/lbc-messaging/auto-reply-check/route.ts
git commit -m "feat(lbc): API route POST /auto-reply-check

Endpoint auth-by-bearer-token appelé par le Chrome Bridge après chaque
upsert lbc_messages. Applique 3 garde-fous :
- LBC_AUTO_REPLY_ENABLED=true (kill-switch)
- 1er message de l'acheteur, contient 'toujours disponible' (case-insensitive)
- pas d'entrée existante dans lbc_outbox (anti-double-fire)
Si OK, INSERT dans lbc_outbox status=pending — le bridge prend le relais.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 : Update middleware `PUBLIC_PATHS`

**Files:**
- Modify: `middleware.ts:4`

- [ ] **Step 1 : Lire l'état actuel**

```bash
cd /Users/elpatroneee/Crm-menuiserie
sed -n '4p' middleware.ts
```
Expected output :
```
const PUBLIC_PATHS = ['/login', '/portail', '/api/portail', '/api/signature', '/d', '/api/d', '/api/gmail/fetch-pj', '/api/gmail', '/api/stripe', '/api/qonto', '/api/taches/rappels']
```

- [ ] **Step 2 : Ajouter le nouveau path**

Utiliser l'outil Edit pour faire le remplacement dans `middleware.ts` :

old_string :
```typescript
const PUBLIC_PATHS = ['/login', '/portail', '/api/portail', '/api/signature', '/d', '/api/d', '/api/gmail/fetch-pj', '/api/gmail', '/api/stripe', '/api/qonto', '/api/taches/rappels']
```

new_string :
```typescript
const PUBLIC_PATHS = ['/login', '/portail', '/api/portail', '/api/signature', '/d', '/api/d', '/api/gmail/fetch-pj', '/api/gmail', '/api/stripe', '/api/qonto', '/api/taches/rappels', '/api/lbc-messaging/auto-reply-check']
```

- [ ] **Step 3 : Vérifier**

```bash
cd /Users/elpatroneee/Crm-menuiserie
grep -c "auto-reply-check" middleware.ts
```
Expected : `1`

- [ ] **Step 4 : TypeScript compile check**

```bash
cd /Users/elpatroneee/Crm-menuiserie
npx tsc --noEmit
```
Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd /Users/elpatroneee/Crm-menuiserie
git add middleware.ts
git commit -m "feat(lbc): bypass auth user middleware sur /api/lbc-messaging/auto-reply-check

L'endpoint est protégé par bearer token (LBC_AUTO_REPLY_SECRET), pas par
session Supabase user — le Chrome Bridge n'a pas de cookie utilisateur.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 : `.gitignore` du bridge + génération du secret

**Files:**
- Modify: `.gitignore`
- Create: `.env.local` est déjà ignoré (déjà dans `.gitignore`) — y ajouter les 3 vars en local

- [ ] **Step 1 : Vérifier que `.env.local` est bien ignoré**

```bash
cd /Users/elpatroneee/Crm-menuiserie
grep -E "^\.env" .gitignore
```
Expected : au moins une ligne contenant `.env*` ou `.env.local`. Si absent, ajouter `.env*.local` au gitignore avant de continuer.

- [ ] **Step 2 : Ajouter le bridge au `.gitignore`**

Utiliser l'outil Edit sur `.gitignore` :

old_string :
```
# production
/build
```

new_string :
```
# production
/build

# LBC Chrome Bridge (contient des secrets en clair, doit rester local)
lbc_chrome_bridge.user.js
```

- [ ] **Step 3 : Générer un secret aléatoire pour LOCAL (dev)**

```bash
openssl rand -hex 32
```
Stocker la valeur produite (32 bytes hex = 64 chars). Ce sera le `LBC_AUTO_REPLY_SECRET` pour `.env.local` UNIQUEMENT (production aura un secret différent en Task 7).

- [ ] **Step 4 : Ajouter les 3 vars dans `.env.local`**

Append à `/Users/elpatroneee/Crm-menuiserie/.env.local` :

```
LBC_AUTO_REPLY_ENABLED=true
LBC_AUTO_REPLY_SECRET=<le hex de Step 3>
LBC_AUTO_REPLY_TEXT="Bonjour, merci pour votre message !\n\nPourriez-vous m'indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !"
```

- [ ] **Step 5 : Vérifier**

```bash
cd /Users/elpatroneee/Crm-menuiserie
grep -E "^LBC_AUTO_REPLY" .env.local | sed 's/=.*$/=<set>/'
```
Expected output :
```
LBC_AUTO_REPLY_ENABLED=<set>
LBC_AUTO_REPLY_SECRET=<set>
LBC_AUTO_REPLY_TEXT=<set>
```

- [ ] **Step 6 : Commit `.gitignore` (pas `.env.local`)**

```bash
cd /Users/elpatroneee/Crm-menuiserie
git status .env.local  # doit montrer "ignored" ou rien — sinon stop, vérifier
git add .gitignore
git commit -m "chore: gitignore lbc_chrome_bridge.user.js (contient secrets)

Le user-script Tampermonkey du bridge contient en clair :
- la SUPABASE_KEY (service role)
- le LBC_AUTO_REPLY_SECRET (à venir)
Il doit rester local sur le Mac mini, jamais commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 : Tests locaux à la curl

Ces tests valident que la route répond correctement à toutes les conditions, en local.

**Files:**
- (aucun fichier modifié)

- [ ] **Step 1 : Démarrer le dev server**

Dans un terminal séparé :
```bash
cd /Users/elpatroneee/Crm-menuiserie
npm run dev
```
Attendre `Ready on http://localhost:3000`.

- [ ] **Step 2 : Récupérer le secret local**

```bash
SECRET=$(grep '^LBC_AUTO_REPLY_SECRET=' /Users/elpatroneee/Crm-menuiserie/.env.local | cut -d= -f2-)
echo "secret length: ${#SECRET}"
```
Expected : `secret length: 64`.

- [ ] **Step 3 : Préparer une conversation de test dans Supabase**

Via `mcp__4182fad8-...__execute_sql` :
```sql
-- Créer une conversation factice avec un seul message acheteur contenant le pattern
INSERT INTO lbc_messages (conversation_id, messages, updated_at)
VALUES (
  'test-auto-reply-1',
  '[{"text": "Bonjour, votre annonce m''intéresse ! Est-elle toujours disponible ?", "isMe": false, "createdAt": "2026-04-28T10:00:00Z"}]'::jsonb,
  now()
)
ON CONFLICT (conversation_id) DO UPDATE SET messages = EXCLUDED.messages, updated_at = now();
```

- [ ] **Step 4 : TEST 401 (pas de token)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"test-auto-reply-1"}'
```
Expected : `401`

- [ ] **Step 5 : TEST 401 (mauvais token)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong-token" \
  -d '{"conversation_id":"test-auto-reply-1"}'
```
Expected : `401`

- [ ] **Step 6 : TEST 400 (body invalide)**

```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{}'
```
Expected : `{"error":"conversation_id required"}` HTTP 400

- [ ] **Step 7 : TEST happy path → triggered=true**

D'abord s'assurer qu'il n'y a pas d'entrée outbox pour cette conv :
```sql
DELETE FROM lbc_outbox WHERE conversation_id='test-auto-reply-1';
```

Puis :
```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"conversation_id":"test-auto-reply-1"}'
```
Expected : `{"triggered":true,"reason":"ok"}`

Vérifier que l'entrée a bien été créée :
```sql
SELECT conversation_id, text, status FROM lbc_outbox WHERE conversation_id='test-auto-reply-1';
```
Expected : 1 ligne, `status='pending'`, `text` contient `"Bonjour, merci pour votre message"`.

- [ ] **Step 8 : TEST anti-double-fire → already_replied**

Re-lancer le même curl que Step 7 sans nettoyer :
```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"conversation_id":"test-auto-reply-1"}'
```
Expected : `{"triggered":false,"reason":"already_replied"}`

- [ ] **Step 9 : TEST not_first_msg (length=2)**

Simuler une conv avec 2 messages :
```sql
DELETE FROM lbc_outbox WHERE conversation_id='test-auto-reply-2';
INSERT INTO lbc_messages (conversation_id, messages, updated_at)
VALUES (
  'test-auto-reply-2',
  '[{"text": "toujours disponible ?", "isMe": false}, {"text": "oui c''est dispo", "isMe": true}]'::jsonb,
  now()
)
ON CONFLICT (conversation_id) DO UPDATE SET messages=EXCLUDED.messages;
```

```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"conversation_id":"test-auto-reply-2"}'
```
Expected : `{"triggered":false,"reason":"not_first_msg"}`

- [ ] **Step 10 : TEST no_match (1er message ne contient pas le pattern)**

```sql
DELETE FROM lbc_outbox WHERE conversation_id='test-auto-reply-3';
INSERT INTO lbc_messages (conversation_id, messages, updated_at)
VALUES (
  'test-auto-reply-3',
  '[{"text": "Bonjour, vous faites Lille ?", "isMe": false}]'::jsonb,
  now()
)
ON CONFLICT (conversation_id) DO UPDATE SET messages=EXCLUDED.messages;
```

```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"conversation_id":"test-auto-reply-3"}'
```
Expected : `{"triggered":false,"reason":"no_match"}`

- [ ] **Step 11 : TEST not_found**

```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"conversation_id":"does-not-exist-xyz"}'
```
Expected : `{"triggered":false,"reason":"not_found"}`

- [ ] **Step 12 : TEST disabled (kill-switch)**

Mettre `LBC_AUTO_REPLY_ENABLED=false` dans `.env.local`, **redémarrer `npm run dev`**, puis :
```bash
curl -s -X POST http://localhost:3000/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d '{"conversation_id":"test-auto-reply-1"}'
```
Expected : `{"triggered":false,"reason":"disabled"}`

Remettre `LBC_AUTO_REPLY_ENABLED=true` et redémarrer le dev server.

- [ ] **Step 13 : Cleanup des données de test**

```sql
DELETE FROM lbc_messages WHERE conversation_id LIKE 'test-auto-reply-%';
DELETE FROM lbc_outbox WHERE conversation_id LIKE 'test-auto-reply-%';
```

- [ ] **Step 14 : Stopper `npm run dev`** (Ctrl+C dans le terminal)

---

## Task 6 : Push & deploy code (env vars Vercel à ajouter avant)

**⚠️ Cette tâche nécessite une action humaine sur le dashboard Vercel — un agent ne peut pas l'exécuter seul.**

**Files:**
- (aucun fichier modifié dans cette tâche)

- [ ] **Step 1 : Générer le secret de PRODUCTION (différent du secret local)**

```bash
openssl rand -hex 32
```
Garder cette valeur de côté (jamais la commit, jamais la coller dans un chat ouvert non chiffré).

- [ ] **Step 2 : Ajouter les 3 env vars dans Vercel**

L'utilisateur doit :
1. Aller sur https://vercel.com/dashboard → projet `crm-menuiserie` → Settings → Environment Variables
2. Add each (scope **Production** coché) :
   - Name: `LBC_AUTO_REPLY_ENABLED` — Value: `true`
   - Name: `LBC_AUTO_REPLY_SECRET` — Value: la valeur de Step 1
   - Name: `LBC_AUTO_REPLY_TEXT` — Value (multi-ligne, autorisé sur Vercel) :
     ```
     Bonjour, merci pour votre message !

     Pourriez-vous m'indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.

     Bonne journée !
     ```
3. Save chaque variable.

- [ ] **Step 3 : Push le code**

```bash
cd /Users/elpatroneee/Crm-menuiserie
git push origin main
```
Vercel redéploie automatiquement avec les nouvelles env vars.

- [ ] **Step 4 : Vérifier le déploiement**

Attendre que le build Vercel finisse (~1-2 min). Vérifier sur https://vercel.com/dashboard que le dernier déploiement est `Ready`.

- [ ] **Step 5 : Sanity check production (sans token doit renvoyer 401)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://crm-menuiserie.vercel.app/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"x"}'
```
Expected : `401`. Si on a `307` (redirect Vercel SSO), c'est que la route n'a pas été ajoutée à `PUBLIC_PATHS` correctement OU que la Vercel Deployment Protection est active sur tout le projet — auquel cas il faut ajouter une exception pour cette route OU désactiver la Deployment Protection. Stop ici et investiguer si pas 401.

---

## Task 7 : Modifier le bridge sur le Mac mini

**⚠️ Cette tâche s'exécute sur le Mac mini (où Tampermonkey tourne), pas sur la machine de dev.**

**Files:**
- Modify: `lbc_chrome_bridge.user.js` (Tampermonkey UI sur le Mac mini)

- [ ] **Step 1 : Ouvrir Tampermonkey**

Sur le Mac mini → Chrome → icône Tampermonkey en haut à droite → Dashboard.
Cliquer sur le script **« LBC Chrome Bridge — Renov-R CRM »** pour l'ouvrir en édition.

- [ ] **Step 2 : Ajouter 2 constantes dans le bloc CONFIG (vers ligne 18-25)**

Trouver le bloc qui contient `const SUPABASE_URL = ...` (vers ligne 18). Juste après la dernière constante du bloc CONFIG (par ex. après `const MSG_FETCH_COUNT = 20;`), ajouter :

```js
  // Auto-reply LBC config (cf docs/superpowers/specs/2026-04-28-lbc-auto-reply-design.md)
  const VERCEL_BASE = 'https://crm-menuiserie.vercel.app';
  const AUTO_REPLY_SECRET = 'COLLER_ICI_LA_VALEUR_LBC_AUTO_REPLY_SECRET_DE_VERCEL';
```

⚠️ Remplacer `COLLER_ICI_...` par la **vraie valeur** de `LBC_AUTO_REPLY_SECRET` que tu as ajoutée sur Vercel à Task 6 Step 2.

- [ ] **Step 3 : Ajouter le ping fire-and-forget après l'upsert lbc_messages**

Trouver le bloc qui se termine par `}); }` (la fin du bloc `await supabaseRequest('POST', 'lbc_messages', { ... })`, autour de la ligne 244 selon ta version actuelle).

Code AVANT modification (à trouver, vérifier le contexte exact) :
```js
    // Upsert dans lbc_messages
    await supabaseRequest('POST', 'lbc_messages', {
      body: {
        conversation_id: conversationId,
        messages: msgs,
        updated_at: new Date().toISOString(),
      },
      filter: 'on_conflict=conversation_id',
      upsert: true,
    });
  }
```

Code APRÈS modification (ajouter le bloc fetch entre `});` et `}` final de la fonction) :
```js
    // Upsert dans lbc_messages
    await supabaseRequest('POST', 'lbc_messages', {
      body: {
        conversation_id: conversationId,
        messages: msgs,
        updated_at: new Date().toISOString(),
      },
      filter: 'on_conflict=conversation_id',
      upsert: true,
    });

    // Ping auto-reply check (fire-and-forget, ne bloque pas la sync)
    try {
      fetch(`${VERCEL_BASE}/api/lbc-messaging/auto-reply-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AUTO_REPLY_SECRET}`,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(e => console.warn('[auto-reply ping]', e));
    } catch (e) {
      console.warn('[auto-reply ping] sync error', e);
    }
  }
```

- [ ] **Step 4 : Sauvegarder dans Tampermonkey**

⌘+S (ou File → Save). Tampermonkey affiche "Saved" en bas.

- [ ] **Step 5 : Recharger l'onglet LBC**

Sur le Mac mini, aller sur l'onglet `https://www.leboncoin.fr/...` qui exécute le bridge → recharger (⌘+R). Vérifier dans la console DevTools (F12) qu'il n'y a pas d'erreur de syntaxe.

Expected : on voit toujours les logs habituels du bridge dans la console, pas de SyntaxError, pas de ReferenceError.

- [ ] **Step 6 : Test fumée du ping en lecture console**

Dans la console DevTools de l'onglet LBC :
```js
fetch('https://crm-menuiserie.vercel.app/api/lbc-messaging/auto-reply-check', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (typeof AUTO_REPLY_SECRET !== 'undefined' ? AUTO_REPLY_SECRET : 'NOT_LOADED'),
  },
  body: JSON.stringify({ conversation_id: 'sanity-check-bridge' }),
}).then(r => r.json()).then(console.log);
```

Expected : `{ triggered: false, reason: 'not_found' }` (la conv n'existe pas, c'est attendu).

Si on a `{ error: 'unauthorized' }` → la constante `AUTO_REPLY_SECRET` n'est pas correctement settée. Re-vérifier Step 2.

---

## Task 8 : Tests d'acceptation E2E en production

**Files:**
- (aucun fichier modifié)

Suivre la liste de la spec §8.

- [ ] **Step 1 : Préparation**

Avoir un 2e compte LBC à dispo (ami, famille, autre numéro). On l'appelle « buyer ».
Une de tes annonces LBC menuiserie sous la main.
Console DevTools ouverte sur l'onglet bridge (Mac mini) pour voir les logs.

- [ ] **Step 2 : TEST 1 — pattern strict 1-clic**

Depuis le compte buyer, cliquer "Contacter" sur une de tes annonces et ne PAS modifier le texte (texte par défaut LBC : *« Bonjour, votre annonce m'intéresse ! Est-elle toujours disponible ? »*). Envoyer.

Attendre ~2 min (le bridge poll inbox toutes les 2 min, puis 5s d'outbox).

Expected : le compte buyer reçoit la réponse Renov-R en moins de 3 min.

Si pas de réponse :
- Check les Vercel function logs : tu dois voir `[auto-reply] conv=<id> reason=ok`
- Check `SELECT * FROM lbc_outbox WHERE created_at > now() - interval '5 minutes'` : il doit y avoir une ligne pending qui passe ensuite à sent
- Check console bridge : tu dois voir le ping partir

- [ ] **Step 3 : TEST 2 — variante "toujours disponible svp ?"**

Depuis le compte buyer (sur une AUTRE annonce, ou re-créer une nouvelle convo) : envoyer *« toujours disponible svp ? »*. Attendre ~2-3 min.

Expected : auto-reply reçue.

- [ ] **Step 4 : TEST 3 — non-match**

Depuis buyer (nouvelle annonce) : envoyer *« Bonjour, vous faites Lille ? »*. Attendre 3 min.

Expected : aucune auto-reply. Logs Vercel : `reason=no_match`.

- [ ] **Step 5 : TEST 4 — anti-loop**

Sur une conv qui a déjà déclenché auto-reply (TEST 1), buyer renvoie *« toujours disponible ? »*. Attendre 3 min.

Expected : aucune 2e auto-reply (la conv a maintenant 3 messages : msg1 buyer, msg2 toi auto, msg3 buyer; donc length≠1, ET il y a déjà une entrée dans lbc_outbox).

- [ ] **Step 6 : TEST 5 — toggle off**

Sur Vercel → Settings → Env vars → `LBC_AUTO_REPLY_ENABLED` → editer → mettre `false` → Save → Redeploy le dernier déploiement.

Attendre que le redeploy soit Ready (~1-2 min).

Buyer envoie le pattern sur une nouvelle conv. Attendre 3 min.

Expected : aucune réponse. Logs Vercel : `reason=disabled`.

Remettre `LBC_AUTO_REPLY_ENABLED=true` + Redeploy.

- [ ] **Step 7 : TEST 6 — réponse manuelle préalable**

Difficile à tester en live car le timing dépend du polling. Skip si TEST 5 a marché — la logique `messages.length===1` est testée en local Task 5 Step 9.

- [ ] **Step 8 : TEST 7 — auth**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://crm-menuiserie.vercel.app/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"x"}'
```
Expected : `401`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://crm-menuiserie.vercel.app/api/lbc-messaging/auto-reply-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong" \
  -d '{"conversation_id":"x"}'
```
Expected : `401`.

- [ ] **Step 9 : TEST 8 — race condition (optionnel)**

Skipper sauf si tu veux pousser. La race est protégée par l'index unique partial créé en Task 1.

- [ ] **Step 10 : Marquer la feature comme validée**

Si TESTS 1, 2, 3, 4, 5, 7 passent, la feature est OK pour la prod. Notes éventuelles :
- Modifier `LBC_AUTO_REPLY_TEXT` sur Vercel si tu veux ajuster le wording (effet immédiat sur prochain auto-reply)
- Pour pause : `LBC_AUTO_REPLY_ENABLED=false` + Redeploy
- Pour observer : Vercel Function Logs filtre `[auto-reply]`

---

## Notes & gotchas

- **Latence réelle** : le `SYNC_INTERVAL` du bridge actuel est de 2 min (pas 30s). Donc l'acheteur peut attendre jusqu'à 2 min avant le ping, puis 5 sec pour l'envoi. Total : ~2 min 5 sec en pire cas. Si tu veux plus rapide, baisse `SYNC_INTERVAL` côté bridge — mais ça augmente la charge LBC.
- **`messages` field** : le bridge stocke chaque message en jsonb avec la clé `isMe` (camelCase). L'API gère aussi `is_me` en défensif. À ne pas modifier.
- **Index unique partial** : si l'INSERT outbox échoue avec code `23505` (duplicate key), c'est que 2 pings simultanés sont arrivés ; on retourne `already_replied` proprement. Pas un bug.
- **Vercel Deployment Protection** : si activée projet-wide, elle peut bloquer l'API même avec `PUBLIC_PATHS` (Next.js middleware). Si après Task 6 Step 5 le code est `307` au lieu de `401`, désactiver la Deployment Protection sur ce projet OU créer un bypass token Vercel. Documenter le choix.
- **Modification du texte sans redeploy** : changer `LBC_AUTO_REPLY_TEXT` sur Vercel s'applique au prochain hit de la fonction sans redeploy (env vars sont lues à runtime). Idem pour `LBC_AUTO_REPLY_ENABLED` (mais Vercel cache les fonctions edge — un redeploy garantit l'application immédiate).

---

## Critères de succès (résumé)

- [ ] Index unique partial créé sur `lbc_outbox(conversation_id) WHERE status IN ('pending','sent')`
- [ ] Endpoint `POST /api/lbc-messaging/auto-reply-check` répond aux 6 codes (`ok`, `disabled`, `not_found`, `not_first_msg`, `no_match`, `already_replied`) en local
- [ ] Middleware ignore l'auth user pour cette route
- [ ] `lbc_chrome_bridge.user.js` est dans `.gitignore` (jamais commit)
- [ ] Bridge sur Mac mini ping bien l'API après chaque upsert (vu dans les logs Vercel)
- [ ] Auto-reply réelle reçue par le buyer en TEST 1 en moins de 3 min
- [ ] `LBC_AUTO_REPLY_ENABLED=false` + Redeploy bloque tout envoi
- [ ] Anti-double-fire vérifié (TEST 4)
