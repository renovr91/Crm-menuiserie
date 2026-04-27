# Téléphonie Ringover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onglet `/telephonie` dans le CRM avec liste des appels Ringover, transcription IA Voxtral + Mistral, et conversion en affaire dans le pipeline.

**Architecture:** Next.js App Router → routes API qui parlent à Ringover, Mistral et Supabase. Cache Supabase (2 nouvelles tables). Frontend React qui lit depuis les routes API.

**Tech Stack:** Next.js 16, TypeScript strict, Supabase (`@supabase/supabase-js`), Ringover API v2, Mistral API (Voxtral + chat completions), Tailwind.

**Spec source:** `docs/superpowers/specs/2026-04-27-ringover-telephony-design.md`

---

## File Structure

**Nouveaux fichiers :**
- `sql/ringover-tables.sql` — schéma DDL (référence, la migration sera appliquée via MCP Supabase)
- `lib/ringover.ts` — client Ringover API (listCalls, downloadRecord, normalizePhone)
- `lib/mistral.ts` — client Mistral (transcribe via Voxtral, summarizeAndExtract via Small)
- `app/api/ringover/sync/route.ts` — POST: fetch Ringover → upsert Supabase
- `app/api/ringover/calls/route.ts` — GET: liste depuis Supabase (avec join transcripts)
- `app/api/ringover/transcribe/route.ts` — POST `{cdr_id}` : audio → texte → résumé
- `app/api/ringover/to-affaire/route.ts` — GET `?cdr_id=X` (match) + POST (create)
- `app/(admin)/telephonie/page.tsx` — page principale (table + filtres)
- `app/(admin)/telephonie/CallRow.tsx` — composant ligne appel
- `app/(admin)/telephonie/CreateAffaireModal.tsx` — modal "Créer affaire"

**Modifié :**
- `app/(admin)/layout.tsx` — ajouter `{ href: '/telephonie', label: 'Téléphonie', icon: '📞' }` dans `NAV_ITEMS`

**Variables d'environnement à ajouter (Vercel + `.env.local`) :**
```
RINGOVER_API_KEY=<dashboard Ringover>
MISTRAL_API_KEY=<console.mistral.ai>
RINGOVER_USER_ID=24321190
```

---

## Task 1: Schéma Supabase (2 tables)

**Files:**
- Create: `sql/ringover-tables.sql`
- Apply: via Supabase MCP migration

- [ ] **Step 1: Écrire le SQL de référence**

Crée `sql/ringover-tables.sql` avec :

```sql
-- Cache des appels Ringover
CREATE TABLE IF NOT EXISTS ringover_calls (
  cdr_id              bigint PRIMARY KEY,
  call_id             text NOT NULL,
  direction           text NOT NULL CHECK (direction IN ('in', 'out')),
  type                text,
  last_state          text,
  is_answered         boolean DEFAULT false,
  start_time          timestamptz NOT NULL,
  answered_time       timestamptz,
  end_time            timestamptz,
  total_duration      int,
  incall_duration     int,
  from_number         text NOT NULL,
  to_number           text NOT NULL,
  contact_number      text,
  record_url          text,
  ringover_user_id    bigint,
  ringover_user_email text,
  raw                 jsonb,
  synced_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ringover_calls_start ON ringover_calls(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_ringover_calls_contact ON ringover_calls(contact_number);

-- Cache des transcriptions + résumés
CREATE TABLE IF NOT EXISTS call_transcripts (
  cdr_id            bigint PRIMARY KEY REFERENCES ringover_calls(cdr_id) ON DELETE CASCADE,
  transcript_text   text,
  summary           text,
  extracted         jsonb,
  audio_duration_s  int,
  voxtral_model     text,
  summary_model     text,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE ringover_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON ringover_calls FOR ALL USING (true);
CREATE POLICY "Service role full access" ON call_transcripts FOR ALL USING (true);
```

- [ ] **Step 2: Appliquer la migration via MCP Supabase**

Utiliser le tool `mcp__4182fad8-...__apply_migration` avec :
- project_id: `ijdbfhwkwxpcxfmiwgad`
- name: `ringover_telephony_tables`
- query: le contenu du fichier SQL ci-dessus

- [ ] **Step 3: Vérifier que les tables existent**

Utiliser `mcp__4182fad8-...__execute_sql` :
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('ringover_calls','call_transcripts')
ORDER BY table_name;
```
Expected: 2 rows (call_transcripts, ringover_calls)

- [ ] **Step 4: Commit**

```bash
git add sql/ringover-tables.sql
git commit -m "feat(ringover): add Supabase schema (ringover_calls + call_transcripts)"
```

---

## Task 2: Lib Ringover

**Files:**
- Create: `lib/ringover.ts`

- [ ] **Step 1: Créer le client Ringover**

```typescript
// lib/ringover.ts
const RINGOVER_API = 'https://public-api.ringover.com/v2';

function apiKey(): string {
  const k = process.env.RINGOVER_API_KEY;
  if (!k) throw new Error('RINGOVER_API_KEY not set');
  return k;
}

export interface RingoverCall {
  cdr_id: number;
  call_id: string;
  direction: 'in' | 'out';
  type: string;
  last_state: string;
  is_answered: boolean;
  start_time: string;
  answered_time: string | null;
  end_time: string | null;
  total_duration: number | null;
  incall_duration: number | null;
  from_number: string;
  to_number: string;
  contact_number: string | null;
  record: string | null;
  user: {
    user_id: number;
    email: string;
    firstname: string;
    lastname: string;
  } | null;
  [key: string]: any;
}

export async function listCalls(opts: { limit?: number; since?: string } = {}): Promise<RingoverCall[]> {
  const limit = opts.limit ?? 100;
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts.since) params.set('start_date', opts.since);

  const r = await fetch(`${RINGOVER_API}/calls?${params}`, {
    headers: { Authorization: apiKey() },
  });
  if (!r.ok) throw new Error(`Ringover API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.call_list || [];
}

export async function downloadRecord(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { Authorization: apiKey() } });
  if (!r.ok) throw new Error(`Download record ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

export function normalizePhone(num: string | null | undefined): string {
  if (!num) return '';
  // Retire tout sauf chiffres
  let n = num.replace(/\D/g, '');
  // 33xxxxxxxxx → 0xxxxxxxxx
  if (n.startsWith('33') && n.length === 11) n = '0' + n.slice(2);
  return n;
}
```

- [ ] **Step 2: Test TypeScript compile**

```bash
cd ~/Crm-menuiserie && npx tsc --noEmit lib/ringover.ts
```
Expected: pas d'erreur

- [ ] **Step 3: Commit**

```bash
git add lib/ringover.ts
git commit -m "feat(ringover): add Ringover API client lib"
```

---

## Task 3: Lib Mistral (Voxtral + Small)

**Files:**
- Create: `lib/mistral.ts`

- [ ] **Step 1: Créer le client Mistral**

```typescript
// lib/mistral.ts
const MISTRAL_API = 'https://api.mistral.ai/v1';
const VOXTRAL_MODEL = 'voxtral-mini-2507';
const SUMMARY_MODEL = 'mistral-small-latest';

function apiKey(): string {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error('MISTRAL_API_KEY not set');
  return k;
}

export interface TranscribeResult {
  text: string;
  duration_s: number;
  model: string;
}

export async function transcribeAudio(audio: Buffer, filename: string): Promise<TranscribeResult> {
  const fd = new FormData();
  fd.append('file', new Blob([audio]), filename);
  fd.append('model', VOXTRAL_MODEL);
  fd.append('language', 'fr');

  const r = await fetch(`${MISTRAL_API}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`Voxtral ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return {
    text: data.text || '',
    duration_s: data.usage?.prompt_audio_seconds || 0,
    model: VOXTRAL_MODEL,
  };
}

export interface ExtractedData {
  name: string | null;
  city: string | null;
  zip_code: string | null;
  phone: string | null;
  email: string | null;
  product_type: string | null;
  quantity: number | null;
  estimated_amount: string | null;
  urgency: string | null;
  next_action: string | null;
}

export interface SummarizeResult {
  summary: string;
  extracted: ExtractedData;
  model: string;
}

export async function summarizeAndExtract(transcript: string): Promise<SummarizeResult> {
  const prompt = `Tu es un assistant qui analyse des appels téléphoniques pour Renov-R (entreprise de menuiseries : fenêtres PVC/alu, portes de garage, volets roulants).

Voici la transcription d'un appel téléphonique :
"""
${transcript}
"""

Tâche : extraire les informations clients pertinentes au format JSON STRICT (pas de texte autour) selon ce schéma :
{
  "summary": "résumé en 2-3 phrases en français",
  "extracted": {
    "name": "nom du client si mentionné, sinon null",
    "city": "ville si mentionnée, sinon null",
    "zip_code": "code postal sur 5 chiffres si mentionné, sinon null",
    "phone": "numéro de téléphone si mentionné, sinon null",
    "email": "email si mentionné, sinon null",
    "product_type": "type de produit (fenetre, porte_garage, volet, autre), sinon null",
    "quantity": "nombre d'éléments si mentionné, sinon null",
    "estimated_amount": "montant ou fourchette si mentionné (ex: '3000€', '4000-5000€'), sinon null",
    "urgency": "haute, moyenne, basse si déduisible, sinon null",
    "next_action": "prochaine étape mentionnée (ex: 'envoyer devis', 'rappeler jeudi'), sinon null"
  }
}

IMPORTANT : réponds UNIQUEMENT avec le JSON valide, rien d'autre.`;

  const r = await fetch(`${MISTRAL_API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`Mistral chat ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      summary: 'Résumé IA non disponible (parsing JSON échoué).',
      extracted: {
        name: null, city: null, zip_code: null, phone: null, email: null,
        product_type: null, quantity: null, estimated_amount: null,
        urgency: null, next_action: null,
      },
      model: SUMMARY_MODEL,
    };
  }
  return {
    summary: parsed.summary || '',
    extracted: { ...parsed.extracted },
    model: SUMMARY_MODEL,
  };
}

// Parse "3000€" → 3000, "3000-5000€" → 4000, "environ 4000" → 4000
export function parseAmount(amount: string | null): number | null {
  if (!amount) return null;
  const cleaned = amount.replace(/[€\s]/g, '').toLowerCase();
  const range = cleaned.match(/(\d+)[-/](\d+)/);
  if (range) return Math.round((parseInt(range[1]) + parseInt(range[2])) / 2);
  const single = cleaned.match(/(\d+)/);
  if (single) return parseInt(single[1]);
  return null;
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
cd ~/Crm-menuiserie && npx tsc --noEmit
```
Expected: pas d'erreur (sur tout le projet)

- [ ] **Step 3: Commit**

```bash
git add lib/mistral.ts
git commit -m "feat(mistral): add Voxtral transcribe + Mistral Small extraction lib"
```

---

## Task 4: API Route /api/ringover/sync (POST)

**Files:**
- Create: `app/api/ringover/sync/route.ts`

- [ ] **Step 1: Créer la route**

```typescript
// app/api/ringover/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { listCalls } from '@/lib/ringover';
import { createAdminClient } from '@/lib/supabase';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = body.limit ?? 100;
    const since = body.since;

    const calls = await listCalls({ limit, since });

    const rows = calls.map((c) => ({
      cdr_id: c.cdr_id,
      call_id: c.call_id,
      direction: c.direction,
      type: c.type,
      last_state: c.last_state,
      is_answered: c.is_answered,
      start_time: c.start_time,
      answered_time: c.answered_time,
      end_time: c.end_time,
      total_duration: c.total_duration,
      incall_duration: c.incall_duration,
      from_number: c.from_number,
      to_number: c.to_number,
      contact_number: c.contact_number,
      record_url: c.record,
      ringover_user_id: c.user?.user_id || null,
      ringover_user_email: c.user?.email || null,
      raw: c,
    }));

    const sb = createAdminClient();
    const { error } = await sb.from('ringover_calls').upsert(rows, { onConflict: 'cdr_id' });
    if (error) throw new Error(`Supabase upsert: ${error.message}`);

    return NextResponse.json({ synced: rows.length });
  } catch (e: any) {
    console.error('[ringover/sync]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Tester via curl en local (`npm run dev` dans un autre terminal)**

```bash
curl -s -X POST http://localhost:3000/api/ringover/sync \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}' | head -c 200
```
Expected: `{"synced": 3}` (3 appels dans la baseline Ringover du compte test)

- [ ] **Step 3: Vérifier en Supabase**

```sql
SELECT cdr_id, direction, contact_number, start_time FROM ringover_calls ORDER BY start_time DESC LIMIT 5;
```
Expected: les 3 appels Ringover qu'on a vus en baseline

- [ ] **Step 4: Commit**

```bash
git add app/api/ringover/sync/route.ts
git commit -m "feat(ringover): API route POST /api/ringover/sync"
```

---

## Task 5: API Route /api/ringover/calls (GET)

**Files:**
- Create: `app/api/ringover/calls/route.ts`

- [ ] **Step 1: Créer la route**

```typescript
// app/api/ringover/calls/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const period = sp.get('period') || 'week'; // today | week | month | all
    const direction = sp.get('direction'); // 'in' | 'out' | null
    const missedOnly = sp.get('missed') === 'true';

    const sb = createAdminClient();
    let q = sb.from('ringover_calls').select('*, transcript:call_transcripts(*)').order('start_time', { ascending: false }).limit(200);

    if (period === 'today') {
      const start = new Date(); start.setHours(0,0,0,0);
      q = q.gte('start_time', start.toISOString());
    } else if (period === 'week') {
      const start = new Date(); start.setDate(start.getDate() - 7);
      q = q.gte('start_time', start.toISOString());
    } else if (period === 'month') {
      const start = new Date(); start.setMonth(start.getMonth() - 1);
      q = q.gte('start_time', start.toISOString());
    }

    if (direction === 'in' || direction === 'out') q = q.eq('direction', direction);
    if (missedOnly) q = q.eq('is_answered', false);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    // transcript renvoyé en array par PostgREST (relation many) → flatten en single
    const calls = (data || []).map((c: any) => ({
      ...c,
      transcript: Array.isArray(c.transcript) ? (c.transcript[0] || null) : c.transcript,
    }));

    return NextResponse.json({ calls });
  } catch (e: any) {
    console.error('[ringover/calls]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Tester via curl**

```bash
curl -s http://localhost:3000/api/ringover/calls?period=month | python3 -m json.tool | head -30
```
Expected: `{"calls": [{cdr_id, direction, ..., transcript: null}, ...]}`

- [ ] **Step 3: Commit**

```bash
git add app/api/ringover/calls/route.ts
git commit -m "feat(ringover): API route GET /api/ringover/calls"
```

---

## Task 6: API Route /api/ringover/transcribe (POST)

**Files:**
- Create: `app/api/ringover/transcribe/route.ts`

- [ ] **Step 1: Créer la route**

```typescript
// app/api/ringover/transcribe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { downloadRecord } from '@/lib/ringover';
import { transcribeAudio, summarizeAndExtract } from '@/lib/mistral';
import { createAdminClient } from '@/lib/supabase';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { cdr_id } = await req.json();
    if (!cdr_id) return NextResponse.json({ error: 'cdr_id required' }, { status: 400 });

    const sb = createAdminClient();

    // 1. Cache check
    const { data: existing } = await sb.from('call_transcripts').select('*').eq('cdr_id', cdr_id).single();
    if (existing) {
      return NextResponse.json({
        transcript: existing.transcript_text,
        summary: existing.summary,
        extracted: existing.extracted,
        cached: true,
      });
    }

    // 2. Get call info
    const { data: call, error: callErr } = await sb.from('ringover_calls').select('*').eq('cdr_id', cdr_id).single();
    if (callErr || !call) return NextResponse.json({ error: 'call not found' }, { status: 404 });
    if (!call.record_url) return NextResponse.json({ error: 'no recording for this call' }, { status: 400 });

    // 3. Download audio
    const audio = await downloadRecord(call.record_url);

    // 4. Transcribe (Voxtral)
    const transcript = await transcribeAudio(audio, `call-${cdr_id}.mp3`);

    // 5. Summarize + extract (Mistral Small)
    const summary = await summarizeAndExtract(transcript.text);

    // 6. Save in cache
    const { error: upErr } = await sb.from('call_transcripts').insert({
      cdr_id,
      transcript_text: transcript.text,
      summary: summary.summary,
      extracted: summary.extracted,
      audio_duration_s: transcript.duration_s,
      voxtral_model: transcript.model,
      summary_model: summary.model,
    });
    if (upErr) console.warn('[transcribe] cache insert failed:', upErr.message);

    return NextResponse.json({
      transcript: transcript.text,
      summary: summary.summary,
      extracted: summary.extracted,
      cached: false,
    });
  } catch (e: any) {
    console.error('[ringover/transcribe]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Tester via curl (avec un cdr_id réel synced en Task 4)**

```bash
# Récupérer un cdr_id avec record_url non null
psql ... # ou via Supabase :
# SELECT cdr_id FROM ringover_calls WHERE record_url IS NOT NULL LIMIT 1;
# Puis :
curl -s -X POST http://localhost:3000/api/ringover/transcribe \
  -H "Content-Type: application/json" \
  -d '{"cdr_id": <REAL_CDR_ID>}' | python3 -m json.tool
```
Expected: `{transcript: "Bonjour, ...", summary: "...", extracted: {...}, cached: false}`

Si aucun appel n'a `record_url` → tester en passant un fichier audio externe via une variante du code (skip ce step et noter à valider plus tard).

- [ ] **Step 3: Re-tester (cache hit)**

Refaire la même requête : `cached: true`.

- [ ] **Step 4: Commit**

```bash
git add app/api/ringover/transcribe/route.ts
git commit -m "feat(ringover): API route POST /api/ringover/transcribe (Voxtral + Mistral Small)"
```

---

## Task 7: API Route /api/ringover/to-affaire (GET match)

**Files:**
- Create: `app/api/ringover/to-affaire/route.ts`

- [ ] **Step 1: Créer la route avec GET (matching)**

```typescript
// app/api/ringover/to-affaire/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalizePhone } from '@/lib/ringover';
import { parseAmount } from '@/lib/mistral';

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const cdr_id = sp.get('cdr_id');
    if (!cdr_id) return NextResponse.json({ error: 'cdr_id required' }, { status: 400 });

    const sb = createAdminClient();

    const { data: call } = await sb.from('ringover_calls').select('*').eq('cdr_id', cdr_id).single();
    if (!call) return NextResponse.json({ error: 'call not found' }, { status: 404 });

    const { data: tr } = await sb.from('call_transcripts').select('*').eq('cdr_id', cdr_id).single();
    const extracted = tr?.extracted || {};

    // contact number selon direction
    const contactRaw = call.direction === 'in' ? call.from_number : call.to_number;
    const contactNorm = normalizePhone(contactRaw);

    // 1. Match clients
    let mode = 'new';
    let client: any = null;
    let lead: any = null;
    if (contactNorm) {
      const { data: clients } = await sb.from('clients').select('*').or(`telephone.eq.${contactNorm},telephone.eq.${contactRaw}`).limit(2);
      if (clients && clients.length === 1) { mode = 'existing'; client = clients[0]; }
      else if (clients && clients.length > 1) { mode = 'ambiguous'; client = clients; }
    }
    if (mode === 'new' && contactNorm) {
      const { data: leads } = await sb.from('lbc_leads').select('*').or(`telephone.eq.${contactNorm},telephone.eq.${contactRaw}`).limit(1);
      if (leads && leads.length > 0) { mode = 'from_lead'; lead = leads[0]; }
    }

    // 2. Match commercial via ringover user_email
    let commercial: any = null;
    if (call.ringover_user_email) {
      const { data: c } = await sb.from('commerciaux').select('id, nom, email').eq('email', call.ringover_user_email).single();
      if (c) commercial = c;
    }

    // 3. Suggested values
    const date = new Date(call.start_time);
    const dateStr = date.toLocaleDateString('fr-FR');
    const product = extracted.product_type || 'téléphonique';
    const titreSuggested = `Appel ${dateStr} - ${product}`;

    return NextResponse.json({
      mode,
      call,
      transcript: tr,
      client,
      lead,
      commercial,
      suggested: {
        nom: extracted.name || lead?.contact_name || client?.nom || '',
        telephone: contactNorm,
        email: extracted.email || lead?.email || client?.email || '',
        ville: extracted.city || lead?.city || client?.ville || '',
        code_postal: extracted.zip_code || lead?.zip_code || client?.code_postal || '',
        adresse: client?.adresse || '',
        titre: titreSuggested,
        description: tr?.summary || '',
        besoin: extracted.product_type || '',
        montant_estime: parseAmount(extracted.estimated_amount),
        pipeline_stage: 'nouveau',
        commercial_id: commercial?.id || null,
      },
    });
  } catch (e: any) {
    console.error('[to-affaire/GET]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Tester via curl**

```bash
curl -s "http://localhost:3000/api/ringover/to-affaire?cdr_id=<CDR_ID>" | python3 -m json.tool
```
Expected: `{mode: "new"|"existing"|"from_lead"|"ambiguous", suggested: {...}, client/lead, commercial, ...}`

- [ ] **Step 3: Commit**

```bash
git add app/api/ringover/to-affaire/route.ts
git commit -m "feat(ringover): API route GET /api/ringover/to-affaire (match phone)"
```

---

## Task 8: API Route /api/ringover/to-affaire (POST create)

**Files:**
- Modify: `app/api/ringover/to-affaire/route.ts` (ajouter export POST)

- [ ] **Step 1: Ajouter le POST**

```typescript
// Ajouter à la fin du fichier app/api/ringover/to-affaire/route.ts

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cdr_id, mode, client_data, affaire_data } = body;
    if (!cdr_id || !mode) return NextResponse.json({ error: 'cdr_id and mode required' }, { status: 400 });

    const sb = createAdminClient();

    // Récupérer l'appel pour activité
    const { data: call } = await sb.from('ringover_calls').select('*').eq('cdr_id', cdr_id).single();
    if (!call) return NextResponse.json({ error: 'call not found' }, { status: 404 });

    let client_id: string;

    // 1. Gérer le client selon le mode
    if (mode === 'existing') {
      client_id = client_data.id;
      // Update fields manquants
      const updates: any = {};
      if (client_data.nom) updates.nom = client_data.nom;
      if (client_data.email) updates.email = client_data.email;
      if (client_data.ville) updates.ville = client_data.ville;
      if (client_data.code_postal) updates.code_postal = client_data.code_postal;
      if (client_data.adresse) updates.adresse = client_data.adresse;
      if (Object.keys(updates).length > 0) {
        await sb.from('clients').update(updates).eq('id', client_id);
      }
    } else if (mode === 'from_lead') {
      // Créer client depuis lead, lier le lead
      const { data: newClient, error } = await sb.from('clients').insert({
        nom: client_data.nom,
        telephone: client_data.telephone,
        email: client_data.email || null,
        ville: client_data.ville || null,
        code_postal: client_data.code_postal || null,
        adresse: client_data.adresse || null,
        source: 'ringover',
      }).select().single();
      if (error) throw new Error(`Insert client: ${error.message}`);
      client_id = newClient.id;
      // Lier le lead
      if (client_data.lead_id) {
        await sb.from('lbc_leads').update({ client_id }).eq('id', client_data.lead_id);
      }
    } else if (mode === 'new') {
      const { data: newClient, error } = await sb.from('clients').insert({
        nom: client_data.nom,
        telephone: client_data.telephone,
        email: client_data.email || null,
        ville: client_data.ville || null,
        code_postal: client_data.code_postal || null,
        adresse: client_data.adresse || null,
        source: 'ringover',
      }).select().single();
      if (error) throw new Error(`Insert client: ${error.message}`);
      client_id = newClient.id;
    } else {
      return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
    }

    // 2. Créer l'affaire
    const { data: affaire, error: affErr } = await sb.from('affaires').insert({
      client_id,
      titre: affaire_data.titre,
      description: affaire_data.description || null,
      pipeline_stage: affaire_data.pipeline_stage || 'nouveau',
      montant_estime: affaire_data.montant_estime || 0,
      commercial_id: affaire_data.commercial_id || null,
    }).select().single();
    if (affErr) throw new Error(`Insert affaire: ${affErr.message}`);

    // 3. Créer activité
    await sb.from('activites').insert({
      client_id,
      commercial_id: affaire_data.commercial_id || null,
      type: 'appel',
      contenu: affaire_data.description || `Appel ${call.direction === 'in' ? 'entrant' : 'sortant'} - ${call.contact_number}`,
      date_faite: call.start_time,
      fait: true,
    });

    return NextResponse.json({ affaire_id: affaire.id, client_id });
  } catch (e: any) {
    console.error('[to-affaire/POST]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Tester via curl**

```bash
curl -s -X POST http://localhost:3000/api/ringover/to-affaire \
  -H "Content-Type: application/json" \
  -d '{
    "cdr_id": <CDR_ID>,
    "mode": "new",
    "client_data": {
      "nom": "Test User",
      "telephone": "0673716765",
      "ville": "Paris"
    },
    "affaire_data": {
      "titre": "Appel test - fenêtre",
      "description": "Test création depuis Ringover",
      "pipeline_stage": "nouveau",
      "montant_estime": 3000
    }
  }'
```
Expected: `{affaire_id: "uuid", client_id: "uuid"}`

- [ ] **Step 3: Vérifier dans Supabase**

```sql
SELECT * FROM affaires ORDER BY created_at DESC LIMIT 1;
SELECT * FROM activites WHERE type='appel' ORDER BY created_at DESC LIMIT 1;
```

- [ ] **Step 4: Commit**

```bash
git add app/api/ringover/to-affaire/route.ts
git commit -m "feat(ringover): API route POST /api/ringover/to-affaire (create affaire+client+activite)"
```

---

## Task 9: Page Téléphonie (squelette + table)

**Files:**
- Create: `app/(admin)/telephonie/page.tsx`
- Create: `app/(admin)/telephonie/CallRow.tsx`

- [ ] **Step 1: Créer le composant CallRow**

```tsx
// app/(admin)/telephonie/CallRow.tsx
'use client'
import { useState } from 'react'

interface RingoverCallWithTranscript {
  cdr_id: number
  direction: 'in' | 'out'
  contact_number: string | null
  from_number: string
  to_number: string
  start_time: string
  total_duration: number | null
  incall_duration: number | null
  is_answered: boolean
  last_state: string
  record_url: string | null
  ringover_user_email: string | null
  transcript: { transcript_text: string; summary: string; extracted: any } | null
}

interface Props {
  call: RingoverCallWithTranscript
  onTranscribed: (cdr_id: number, data: any) => void
  onCreateAffaire: (cdr_id: number) => void
}

export default function CallRow({ call, onTranscribed, onCreateAffaire }: Props) {
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const date = new Date(call.start_time)
  const dateStr = date.toLocaleDateString('fr-FR')
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const durStr = call.incall_duration
    ? `${Math.floor(call.incall_duration / 60)}m${call.incall_duration % 60}s`
    : '-'
  const directionIcon = call.direction === 'in' ? '📞➡️' : '➡️📞'
  const stateIcon = call.is_answered ? '✅' : '❌'

  async function handleTranscribe() {
    setLoading(true)
    try {
      const r = await fetch('/api/ringover/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdr_id: call.cdr_id }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Transcribe failed')
      onTranscribed(call.cdr_id, data)
    } catch (e: any) {
      alert(`Transcription échouée: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border rounded-lg p-3 mb-2 bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span>{directionIcon}</span>
            <span>{stateIcon}</span>
            <span className="font-semibold truncate">{call.contact_number || call.from_number}</span>
            <span className="text-gray-500 text-xs">{dateStr} {timeStr}</span>
            <span className="text-gray-400 text-xs">{durStr}</span>
          </div>
          {call.transcript?.summary && (
            <div className="text-sm text-gray-700 mt-1">{call.transcript.summary}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {call.record_url && (
            <audio controls src={call.record_url} className="h-8" preload="none" />
          )}
          {!call.transcript && call.record_url && (
            <button onClick={handleTranscribe} disabled={loading} className="px-3 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50">
              {loading ? '...' : '🎤 Résumer'}
            </button>
          )}
          <button onClick={() => onCreateAffaire(call.cdr_id)} className="px-3 py-1 text-xs rounded bg-green-600 text-white">
            📋 Créer affaire
          </button>
          {call.transcript && (
            <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-500">
              {expanded ? 'Cacher' : 'Détails'}
            </button>
          )}
        </div>
      </div>
      {expanded && call.transcript && (
        <div className="mt-3 pt-3 border-t text-sm">
          <div className="font-semibold mb-1">Transcription</div>
          <div className="whitespace-pre-wrap text-gray-600 text-xs max-h-48 overflow-y-auto">{call.transcript.transcript_text}</div>
          <div className="font-semibold mt-2 mb-1">Infos extraites</div>
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">{JSON.stringify(call.transcript.extracted, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Créer la page principale**

```tsx
// app/(admin)/telephonie/page.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import CallRow from './CallRow'

export default function TelephoniePage() {
  const [calls, setCalls] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('period', period)
      if (direction !== 'all') params.set('direction', direction)
      const r = await fetch(`/api/ringover/calls?${params}`)
      const data = await r.json()
      setCalls(data.calls || [])
    } catch (e: any) {
      alert(`Load failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [period, direction])

  useEffect(() => { load() }, [load])

  async function handleSync() {
    setSyncing(true)
    try {
      const r = await fetch('/api/ringover/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Sync failed')
      await load()
    } catch (e: any) {
      alert(`Sync failed: ${e.message}`)
    } finally { setSyncing(false) }
  }

  function handleTranscribed(cdr_id: number, data: any) {
    setCalls(prev => prev.map(c => c.cdr_id === cdr_id ? { ...c, transcript: { transcript_text: data.transcript, summary: data.summary, extracted: data.extracted } } : c))
  }

  function handleCreateAffaire(cdr_id: number) {
    // TODO Task 10 — ouvrir le modal
    alert(`TODO: Modal créer affaire pour ${cdr_id}`)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">📞 Téléphonie</h1>
        <button onClick={handleSync} disabled={syncing} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50">
          {syncing ? 'Sync...' : '🔄 Refresh'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <select value={period} onChange={e => setPeriod(e.target.value as any)} className="border rounded px-3 py-1 text-sm">
          <option value="today">Aujourd'hui</option>
          <option value="week">7 jours</option>
          <option value="month">30 jours</option>
          <option value="all">Tout</option>
        </select>
        <select value={direction} onChange={e => setDirection(e.target.value as any)} className="border rounded px-3 py-1 text-sm">
          <option value="all">Tous</option>
          <option value="in">Entrants</option>
          <option value="out">Sortants</option>
        </select>
      </div>

      {loading ? (
        <div>Chargement...</div>
      ) : calls.length === 0 ? (
        <div className="text-gray-500">Aucun appel. Cliquez sur Refresh pour synchroniser.</div>
      ) : (
        <div>{calls.map(c => <CallRow key={c.cdr_id} call={c} onTranscribed={handleTranscribed} onCreateAffaire={handleCreateAffaire} />)}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Ajouter onglet dans NAV_ITEMS**

Modifier `app/(admin)/layout.tsx` lignes 8-20 (le bloc `NAV_ITEMS = [...]`) pour ajouter :
```typescript
  { href: '/telephonie', label: 'Téléphonie', icon: '📞' },
```
À placer juste après `messagerie-lbc` (ligne 13).

- [ ] **Step 4: Tester en local**

```bash
cd ~/Crm-menuiserie && npm run dev
# Ouvrir http://localhost:3000/telephonie
# Cliquer "Refresh"
# Vérifier que la liste apparaît
```

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/telephonie/page.tsx app/\(admin\)/telephonie/CallRow.tsx app/\(admin\)/layout.tsx
git commit -m "feat(ringover): page Telephonie + CallRow + nav entry"
```

---

## Task 10: Modal CreateAffaire

**Files:**
- Create: `app/(admin)/telephonie/CreateAffaireModal.tsx`
- Modify: `app/(admin)/telephonie/page.tsx` (wire up le modal)

- [ ] **Step 1: Créer le modal**

```tsx
// app/(admin)/telephonie/CreateAffaireModal.tsx
'use client'
import { useState, useEffect } from 'react'

interface Props {
  cdr_id: number | null
  onClose: () => void
  onCreated: () => void
}

export default function CreateAffaireModal({ cdr_id, onClose, onCreated }: Props) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<any>({})
  const [commerciaux, setCommerciaux] = useState<any[]>([])

  useEffect(() => {
    if (!cdr_id) return
    setLoading(true)
    Promise.all([
      fetch(`/api/ringover/to-affaire?cdr_id=${cdr_id}`).then(r => r.json()),
      fetch('/api/commerciaux').then(r => r.ok ? r.json() : []),
    ]).then(([d, comms]) => {
      setData(d)
      setForm({ ...d.suggested })
      setCommerciaux(Array.isArray(comms) ? comms : (comms.commerciaux || []))
    }).finally(() => setLoading(false))
  }, [cdr_id])

  async function submit() {
    if (!cdr_id || !data) return
    setSubmitting(true)
    try {
      const body: any = {
        cdr_id,
        mode: data.mode,
        client_data: {
          nom: form.nom,
          telephone: form.telephone,
          email: form.email || null,
          ville: form.ville || null,
          code_postal: form.code_postal || null,
          adresse: form.adresse || null,
        },
        affaire_data: {
          titre: form.titre,
          description: form.description || null,
          pipeline_stage: form.pipeline_stage || 'nouveau',
          montant_estime: form.montant_estime ? Number(form.montant_estime) : 0,
          commercial_id: form.commercial_id || null,
        },
      }
      if (data.mode === 'existing' && data.client) body.client_data.id = data.client.id
      if (data.mode === 'from_lead' && data.lead) body.client_data.lead_id = data.lead.id

      const r = await fetch('/api/ringover/to-affaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error || 'Create failed')
      onCreated()
    } catch (e: any) {
      alert(`Erreur: ${e.message}`)
    } finally { setSubmitting(false) }
  }

  if (!cdr_id) return null

  const modeLabels: any = {
    existing: '🟢 Client existant',
    from_lead: '🔵 Lead LBC trouvé',
    ambiguous: '⚠️ Plusieurs clients trouvés',
    new: '🆕 Nouveau client',
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">📋 Créer une affaire</h2>
          <button onClick={onClose} className="text-gray-500">✕</button>
        </div>

        {loading ? (
          <div>Chargement...</div>
        ) : !data ? (
          <div>Erreur de chargement</div>
        ) : (
          <>
            <div className="mb-3 px-3 py-2 bg-gray-50 rounded text-sm">
              {modeLabels[data.mode] || data.mode}
              {data.client && data.mode === 'existing' && ` — ${data.client.nom}`}
              {data.lead && data.mode === 'from_lead' && ` — ${data.lead.contact_name}`}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nom" value={form.nom} onChange={v => setForm({ ...form, nom: v })} />
              <Field label="Téléphone" value={form.telephone} onChange={v => setForm({ ...form, telephone: v })} />
              <Field label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
              <Field label="Ville" value={form.ville} onChange={v => setForm({ ...form, ville: v })} />
              <Field label="Code postal" value={form.code_postal} onChange={v => setForm({ ...form, code_postal: v })} />
              <Field label="Adresse" value={form.adresse} onChange={v => setForm({ ...form, adresse: v })} />
              <Field label="Titre affaire" value={form.titre} onChange={v => setForm({ ...form, titre: v })} className="col-span-2" />
              <div className="col-span-2">
                <label className="text-sm font-medium">Description</label>
                <textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border rounded px-2 py-1 text-sm" rows={3} />
              </div>
              <Field label="Besoin (produit)" value={form.besoin} onChange={v => setForm({ ...form, besoin: v })} />
              <Field label="Montant estimé (€)" value={form.montant_estime} onChange={v => setForm({ ...form, montant_estime: v })} />
              <div>
                <label className="text-sm font-medium">Commercial</label>
                <select value={form.commercial_id || ''} onChange={e => setForm({ ...form, commercial_id: e.target.value || null })} className="w-full border rounded px-2 py-1 text-sm">
                  <option value="">— Choisir —</option>
                  {commerciaux.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Pipeline</label>
                <select value={form.pipeline_stage || 'nouveau'} onChange={e => setForm({ ...form, pipeline_stage: e.target.value })} className="w-full border rounded px-2 py-1 text-sm">
                  <option value="nouveau">Nouveau</option>
                  <option value="en_cours">En cours</option>
                  <option value="devis_envoye">Devis envoyé</option>
                  <option value="signe">Signé</option>
                  <option value="perdu">Perdu</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="px-4 py-2 rounded border">Annuler</button>
              <button onClick={submit} disabled={submitting || !form.nom || !form.titre} className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50">
                {submitting ? 'Création...' : 'Créer affaire'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, className = '' }: { label: string; value: any; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={className}>
      <label className="text-sm font-medium">{label}</label>
      <input value={value || ''} onChange={e => onChange(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
    </div>
  )
}
```

- [ ] **Step 2: Wire up dans la page**

Modifier `app/(admin)/telephonie/page.tsx` :
- Importer `CreateAffaireModal`
- Ajouter state `const [modalCdrId, setModalCdrId] = useState<number | null>(null)`
- Remplacer la fonction `handleCreateAffaire` par `setModalCdrId(cdr_id)`
- Ajouter à la fin du JSX (avant `</div>` final) :
```tsx
<CreateAffaireModal
  cdr_id={modalCdrId}
  onClose={() => setModalCdrId(null)}
  onCreated={() => { setModalCdrId(null); load(); alert('✅ Affaire créée'); }}
/>
```

- [ ] **Step 3: Tester en local**

```bash
npm run dev
# Ouvrir /telephonie
# Cliquer "Créer affaire" sur un appel
# Vérifier que le modal s'ouvre avec les champs pré-remplis
# Valider → vérifier que l'affaire apparaît dans /pipeline
```

- [ ] **Step 4: Commit**

```bash
git add app/\(admin\)/telephonie/CreateAffaireModal.tsx app/\(admin\)/telephonie/page.tsx
git commit -m "feat(ringover): CreateAffaireModal with auto-fill from extracted data"
```

---

## Task 11: Test end-to-end + déploiement

- [ ] **Step 1: TypeScript check global**

```bash
cd ~/Crm-menuiserie && npx tsc --noEmit
```
Expected: pas d'erreur

- [ ] **Step 2: Lint check**

```bash
npm run lint
```
Expected: pas d'erreur (warnings OK)

- [ ] **Step 3: Test fonctionnel manuel complet**

1. `npm run dev`
2. Ouvrir http://localhost:3000/telephonie
3. Cliquer **🔄 Refresh** → vérifier qu'on voit les appels Ringover
4. Cliquer **🎤 Résumer** sur un appel ayant un `record_url` → vérifier que le résumé apparaît
5. Cliquer **📋 Créer affaire** → modal pré-rempli s'ouvre
6. Compléter le commercial, valider → toast succès
7. Aller sur **/pipeline** → vérifier que l'affaire est créée
8. Aller sur la fiche client → vérifier que l'activité d'appel apparaît dans la timeline

- [ ] **Step 4: Ajouter les variables d'env Vercel**

Dans Vercel Project Settings → Environment Variables :
- `RINGOVER_API_KEY` = (la vraie clé Ringover)
- `MISTRAL_API_KEY` = (la vraie clé Mistral)

- [ ] **Step 5: Déployer**

```bash
git push origin main
```
Vercel redéploie automatiquement. Vérifier le build sur le dashboard Vercel.

- [ ] **Step 6: Test en prod**

Ouvrir l'URL Vercel → /telephonie → refaire le test E2E.

- [ ] **Step 7: Commit final si fixes**

Si des fixes sont nécessaires après les tests :
```bash
git add -A
git commit -m "fix(ringover): adjustments after e2e test"
git push
```

---

## Notes & gotchas

- **Direction de l'appel** : si `direction='in'`, le contact = `from_number`. Si `direction='out'`, le contact = `to_number`. La colonne `contact_number` Ringover est déjà calculée mais on garde notre logique au cas où elle serait null.
- **Audio Ringover** : le champ `record` peut être `null` (appels < 10s, missed, etc.) → le bouton Résumer doit être caché si pas d'audio.
- **Voxtral hallucinations** : sur du silence ou audio trop court, Voxtral peut inventer du texte. Si l'audio est < 3s, on peut skip la transcription côté API (ajouter un check sur `total_duration`).
- **Mistral JSON parsing** : si Mistral renvoie du JSON invalide, on ne plante pas — on retourne summary vide + extracted vide. L'user remplit manuellement.
- **RLS Supabase** : les routes API utilisent `createAdminClient()` (service role key) pour bypass RLS. Les routes sont protégées par auth Supabase via le middleware existant.
- **Phone matching** : on essaie `normalizePhone()` ET le format brut (avec +33). Pour matching multi-format, considère d'ajouter une colonne `phone_normalized` à `clients` plus tard.
- **maxDuration Vercel** : sync = 60s, transcribe = 120s (les enregistrements peuvent être longs). En plan free Vercel, max 10s — donc upgrade Pro nécessaire OU découper le travail.

---

## Critères de succès

- [ ] L'onglet `/telephonie` apparaît dans la nav et charge sans erreur
- [ ] Le bouton Refresh sync les appels Ringover en Supabase
- [ ] Le bouton Résumer génère transcript + résumé + JSON extrait
- [ ] Le bouton Créer affaire ouvre un modal pré-rempli intelligent
- [ ] La validation crée client + affaire + activité d'appel
- [ ] L'affaire apparaît dans `/pipeline`
- [ ] L'activité apparaît dans la timeline du client
- [ ] Coût Mistral < $1/mois en usage normal (5-10 appels résumés/jour)
