# Auto-reply LBC sur message "toujours disponible"

**Date :** 2026-04-28
**Statut :** Design validé, prêt pour planification

---

## 1. Problème & objectif

Le 1-clic LeBonCoin pré-remplit le message *« Bonjour, votre annonce m'intéresse ! Est-elle toujours disponible ? »*. Renov-R reçoit ce type de message en masse sur ses annonces de menuiseries. Y répondre manuellement à chacun fait perdre du temps et n'apporte aucune valeur.

**Objectif :** quand un acheteur démarre une nouvelle conversation LBC avec un message contenant *« toujours disponible »*, le CRM répond automatiquement, une seule fois, avec un texte fixe demandant les dimensions et le numéro de téléphone.

**Critère de succès :** zéro intervention humaine pour ce cas, ~30s à 1 min de latence entre le message reçu et la réponse envoyée, aucune double-réponse.

---

## 2. Scope

### Inclus
- Détection d'un nouveau message LBC contenant la substring *« toujours disponible »* (case-insensitive) en **premier message** d'une conversation
- Envoi d'un texte de réponse fixe configuré via env var
- Garde-fous anti-loop, anti-double-fire, kill-switch global
- Logs sur Vercel pour observabilité

### Exclus (YAGNI v1)
- Délai d'envoi humain (instant via le bridge)
- Restriction heures ouvrées
- UI de toggle dans le CRM (le toggle se fait via env var Vercel)
- Statistiques / dashboard d'utilisation
- Variantes de réponse, personnalisation par annonce
- IA / LLM (réponse 100% statique)
- Détection des variantes hors *« toujours disponible »* (genre *« encore dispo ? »*) — couvre ~90 % des cas en v1

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────┐
│  Acheteur LBC clique "1-clic" → message envoyé         │
└────────────────────┬───────────────────────────────────┘
                     │
                     ▼  (~30 s, prochain poll inbox)
┌────────────────────────────────────────────────────────┐
│  Chrome Bridge (Mac mini, Tampermonkey)                │
│   1. Poll LBC, détecte le nouveau message              │
│   2. UPSERT lbc_messages (existant, INCHANGÉ)          │
│   3. NEW: fetch POST <vercel>/api/lbc-messaging/       │
│           auto-reply-check { conversation_id }         │
│      Header: Authorization: Bearer <secret>            │
└────────────────────┬───────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│  Vercel API : /api/lbc-messaging/auto-reply-check      │
│   ├─ Vérifie token secret (sinon 401)                  │
│   ├─ Vérifie LBC_AUTO_REPLY_ENABLED='true'             │
│   ├─ Charge la conv depuis lbc_messages                │
│   ├─ Applique les 3 garde-fous (cf §4)                 │
│   └─ Si OK → INSERT lbc_outbox (status='pending')      │
└────────────────────┬───────────────────────────────────┘
                     │
                     ▼  (~30 s, prochain poll outbox)
┌────────────────────────────────────────────────────────┐
│  Chrome Bridge envoie via UI LBC (existant, INCHANGÉ)  │
│   → marque lbc_outbox.status='sent'                    │
└────────────────────────────────────────────────────────┘
```

**Latence totale** : ~30 s à 1 min entre le message reçu côté LBC et la réponse envoyée.

**Composants modifiés** : 1 ligne dans le bridge + 1 ligne dans `middleware.ts`.
**Composants nouveaux** : 1 fichier API route TypeScript + 1 contrainte d'unicité Postgres.

---

## 4. Règles de détection (3 garde-fous)

L'API `auto-reply-check` ne déclenche un envoi **que si toutes** les conditions suivantes sont remplies :

| # | Condition | Justification |
|---|-----------|---------------|
| 1 | `process.env.LBC_AUTO_REPLY_ENABLED === 'true'` | Kill-switch immédiat depuis Vercel. Utile pour pauser sans redeploy. |
| 2 | `messages.length === 1` ET `messages[0].is_me === false` (ou `isMe === false`) ET le texte normalisé (lowercase + trim) **contient** `"toujours disponible"` | Détection souple sur le 1er message uniquement, couvre les variantes. La règle « 1 seul message » gère implicitement : (a) tu as déjà répondu manuellement → length ≥ 2 → no fire ; (b) acheteur revient sur même conv → length > 1 → no fire ; (c) acheteur revient via nouvelle conv → nouveau `conversation_id` → fire OK. |
| 3 | `SELECT COUNT(*) FROM lbc_outbox WHERE conversation_id = X` retourne 0 | Anti-double-fire. Couvre le cas où le bridge ping 2× la même conv (idempotence). |

Si une condition échoue → réponse `{ triggered: false, reason: '<code>' }`. Pas d'erreur 500. Loggé sur Vercel.

Si toutes OK → INSERT dans `lbc_outbox`.

### Race condition : double-insert

Cas extrêmement rare (2 pings simultanés sur la même conv). Mitigation **dans la migration SQL** :

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_lbc_outbox_conv_active
  ON lbc_outbox (conversation_id)
  WHERE status IN ('pending', 'sent');
```

Le 2e INSERT échouera avec `unique_violation` → l'API capture l'erreur et retourne `{ triggered: false, reason: 'already_replied' }`.

---

## 5. Composants

### 5.1 Backend route

**Fichier** : `app/api/lbc-messaging/auto-reply-check/route.ts`

**Endpoint** : `POST /api/lbc-messaging/auto-reply-check`

**Auth** : header `Authorization: Bearer <LBC_AUTO_REPLY_SECRET>`. Pas d'auth Supabase user (le bridge n'a pas de session). Le secret est ajouté à `PUBLIC_PATHS` du middleware pour bypass l'auth user, et l'API re-vérifie elle-même le bearer token.

**Body (JSON)** :
```ts
{ conversation_id: string }
```

**Réponse (200)** :
```ts
{
  triggered: boolean,
  reason: 'ok' | 'disabled' | 'not_found' | 'not_first_msg' | 'no_match' | 'already_replied'
}
```

**Erreurs** :
- `401` si bearer token absent ou invalide
- `400` si `conversation_id` manquant
- `500` si erreur Supabase

**Logique (pseudo-code)** :
```ts
1. Vérifier Authorization header == "Bearer ${LBC_AUTO_REPLY_SECRET}"
2. Parser body, extraire conversation_id
3. Si LBC_AUTO_REPLY_ENABLED !== 'true' → return { triggered: false, reason: 'disabled' }
4. SELECT messages FROM lbc_messages WHERE conversation_id = X
5. Si pas de row → return { triggered: false, reason: 'not_found' }
6. Si messages.length !== 1 ou messages[0].isMe !== false → return { triggered: false, reason: 'not_first_msg' }
7. text = messages[0].text.toLowerCase().trim()
8. Si !text.includes('toujours disponible') → return { triggered: false, reason: 'no_match' }
9. SELECT COUNT(*) FROM lbc_outbox WHERE conversation_id = X
10. Si count > 0 → return { triggered: false, reason: 'already_replied' }
11. INSERT INTO lbc_outbox (conversation_id, text, status='pending')
    Si unique_violation → return { triggered: false, reason: 'already_replied' }
12. console.log('[auto-reply] conv=X triggered text-len=Y')
13. return { triggered: true, reason: 'ok' }
```

### 5.2 Modification du bridge

**Fichier** : `lbc_chrome_bridge.user.js`

**Changement** : ajouter, juste après le bloc qui upsert dans `lbc_messages` (ligne ~234), un `fetch()` fire-and-forget vers l'API.

**Constantes en haut du fichier** :
```js
const VERCEL_BASE = 'https://crm-menuiserie.vercel.app'
const AUTO_REPLY_SECRET = '<même valeur que LBC_AUTO_REPLY_SECRET côté Vercel>'
```

**Hook après upsert** :
```js
fetch(`${VERCEL_BASE}/api/lbc-messaging/auto-reply-check`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTO_REPLY_SECRET}`,
  },
  body: JSON.stringify({ conversation_id: convId }),
}).catch((e) => console.warn('[auto-reply ping]', e))
```

Pas de `await` : on n'attend pas le résultat. Si l'API échoue, le bridge poursuit son cycle normalement.

### 5.3 Migration SQL

**Fichier** : `sql/lbc-outbox-unique-index.sql` (référence ; appliqué via MCP Supabase migration `lbc_outbox_unique_active_per_conversation`)

**Contenu** :
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_lbc_outbox_conv_active
  ON lbc_outbox (conversation_id)
  WHERE status IN ('pending', 'sent');
```

### 5.4 Modification du middleware

**Fichier** : `middleware.ts`

**Changement** : ajouter `/api/lbc-messaging/auto-reply-check` à `PUBLIC_PATHS`.

```ts
// Avant
const PUBLIC_PATHS = ['/login', '/portail', '/api/portail', '/api/signature', '/d', '/api/d', '/api/gmail/fetch-pj', '/api/gmail', '/api/stripe', '/api/qonto', '/api/taches/rappels']

// Après
const PUBLIC_PATHS = ['/login', '/portail', '/api/portail', '/api/signature', '/d', '/api/d', '/api/gmail/fetch-pj', '/api/gmail', '/api/stripe', '/api/qonto', '/api/taches/rappels', '/api/lbc-messaging/auto-reply-check']
```

L'auth est faite **dans la route** par le bearer token, pas par le middleware Supabase.

### 5.5 Variables d'environnement

À ajouter dans Vercel Project Settings → Environment Variables (scope **Production**) :

| Variable | Exemple de valeur |
|---|---|
| `LBC_AUTO_REPLY_ENABLED` | `true` |
| `LBC_AUTO_REPLY_SECRET` | Une string aléatoire de 32+ caractères, ex. générée avec `openssl rand -hex 32` |
| `LBC_AUTO_REPLY_TEXT` | `"Bonjour, merci pour votre message !\n\nPourriez-vous m'indiquer vos dimensions et me laisser votre numéro de téléphone ? Je vous envoie le devis directement par SMS.\n\nBonne journée !"` |

⚠️ La même valeur de `LBC_AUTO_REPLY_SECRET` doit être collée dans la constante `AUTO_REPLY_SECRET` du bridge (`lbc_chrome_bridge.user.js`).

### 5.6 Pas de UI v1

Le toggle se fait via Vercel (env var → redeploy). Une UI dans `/messagerie-lbc` pourra venir en v2 avec un compteur d'usage.

---

## 6. Data flow détaillé (timeline)

```
T+0     Acheteur clique "1-clic" sur ton annonce LBC
T+30s   Bridge poll LBC → upsert lbc_messages (1 nouvelle conv, 1 msg)
T+30s   Bridge fire-and-forget POST /auto-reply-check
T+30s   API check les 3 conditions → INSERT lbc_outbox status=pending
T+60s   Bridge poll outbox → trouve l'entrée pending
T+60s   Bridge envoie via UI LBC (existant) → mark sent_at
T+~75s  Acheteur reçoit la réponse côté LBC
```

Latence pire cas (~75 s) acceptable pour le besoin.

---

## 7. Observabilité

- **Logs Vercel** (function logs sur le projet) : chaque hit logge `[auto-reply] conv=<X> reason=<Y>`. Filtre par `[auto-reply]` pour audit.
- **Visibilité côté CRM** : l'auto-réponse apparaît dans `/messagerie-lbc` comme n'importe quel message envoyé (`is_me=true`). Aucun marqueur visuel spécifique en v1.
- **Compteur ad-hoc** (manuel, en attendant un dashboard) :
  ```sql
  SELECT date_trunc('day', created_at) AS jour, COUNT(*)
  FROM lbc_outbox
  WHERE created_at > now() - interval '7 days'
  GROUP BY 1 ORDER BY 1 DESC;
  ```

---

## 8. Tests d'acceptation

À exécuter avant de marquer la feature comme validée. Toutes les vérifs se font côté production (Vercel).

1. **Pattern strict 1-clic** : depuis un autre compte LBC, envoyer le message *« Bonjour, votre annonce m'intéresse ! Est-elle toujours disponible ? »* sur une nouvelle annonce → l'acheteur reçoit la réponse dans la minute.
2. **Variante** : envoyer *« Bonjour, c'est toujours disponible ? »* → fire OK.
3. **Non-match** : envoyer *« Bonjour, vous faites Lille ? »* → pas de réponse, log `no_match`.
4. **Anti-loop** : sur une conv déjà déclenchée, l'acheteur ré-envoie *« toujours disponible ? »* 30 min plus tard → pas de 2e auto-reply (length ≥ 2 OU outbox non vide).
5. **Toggle off** : `LBC_AUTO_REPLY_ENABLED=false` sur Vercel + Redeploy → envoyer le pattern → aucun envoi, log `disabled`.
6. **Après réponse manuelle** : ouvrir une conv vierge, répondre manuellement avant que l'API ait fire, l'acheteur ré-écrit le pattern → pas de fire (length ≥ 2).
7. **Auth** : `curl -X POST -H 'Content-Type: application/json' -d '{"conversation_id":"x"}' <vercel>/api/lbc-messaging/auto-reply-check` SANS bearer → 401.
8. **Race condition** : (test optionnel) appel 2× simultané avec curl + même conv → seule la 1re INSERT passe, la 2e renvoie `already_replied`.

---

## 9. Risques & mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| Bridge offline (Mac mini éteint) | Moyenne | Le ping échoue silencieusement, l'API ne reçoit rien → aucune réponse envoyée. C'est ce qu'on veut. |
| Vercel down | Faible | Bridge ignore l'erreur, conv reste sans réponse, tu réponds manuellement comme aujourd'hui. Pas de dégradation par rapport à l'existant. |
| Faux positif (un acheteur écrit un long message qui contient "toujours disponible" en passant) | Faible | Le filtre `messages.length === 1` limite. Un long message qui contient la phrase = c'est probablement bien le cas qu'on veut filtrer. |
| Token leak (secret dans `lbc_chrome_bridge.user.js` versionné sur GitHub) | Élevée si on commit le bridge tel quel | **Le bridge .user.js ne doit pas être commit avec le vrai secret**. Soit on le garde local et l'utilisateur copie le secret manuellement, soit on lit le secret depuis Tampermonkey GM_setValue. Choix v1 : le fichier `lbc_chrome_bridge.user.js` reste git-ignoré (déjà actuellement non versionné dans `main`). |
| Acheteur écrit un truc bidon en 1 mot pour forcer l'envoi | Faible | Ne contient pas "toujours disponible" → pas de fire. |

---

## 10. Plan d'évolution (v2+, hors scope)

Idées notées pour plus tard, pas implémentées maintenant :
- **Heures ouvrées** : ne fire qu'entre 8h et 20h, sinon délai jusqu'au lendemain matin
- **Délai d'envoi humain** : ajouter un champ `send_after` à `lbc_outbox` pour différer
- **UI toggle** dans `/messagerie-lbc` (bouton on/off + compteur 7 derniers jours)
- **Variante de filtre** : élargir à `/dispo|disponible|encore|libre/i`
- **IA-personnalisation** : intégrer le titre de l'annonce dans la réponse via Mistral
- **Multi-réponse selon le contexte** : si l'acheteur précise déjà sa ville, ajuster la réponse

---

## 11. Critères de validation v1

- [ ] L'API `POST /api/lbc-messaging/auto-reply-check` répond correctement aux 3 conditions
- [ ] Le bridge ping bien après chaque upsert
- [ ] Une vraie auto-réponse part en moins de 90 s sur le test E2E réel
- [ ] Le toggle `ENABLED=false` désactive bien l'envoi
- [ ] Aucune double-réponse n'a été observée pendant 7 jours d'usage normal
