# CRM Menuiserie RENOV-R 91 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete CRM for RENOV-R 91 with pipeline Kanban, client management, order/delivery tracking, installation scheduling, SAV tickets, team management, and AI-powered lead import.

**Architecture:** Next.js App Router with Supabase backend. Sidebar navigation replacing the existing top nav. Server components for data pages, client components for interactive features. All API routes use `createAdminClient()` from `@/lib/supabase`.

**Tech Stack:** Next.js 14+ App Router, Supabase (PostgreSQL), Tailwind CSS, Anthropic API (for AI import)

**Supabase Project ID:** `ijdbfhwkwxpcxfmiwgad`

---

## File Structure

### New Files

```
app/(admin)/
  layout.tsx                         -- MODIFY: sidebar navigation
  page.tsx                           -- MODIFY: redirect to /pipeline
  pipeline/page.tsx                  -- Kanban board
  clients/[id]/page.tsx              -- REWRITE: rich fiche client with tabs
  livraisons/page.tsx                -- Delivery tracking table
  planning/page.tsx                  -- Installation schedule
  sav/page.tsx                       -- SAV ticket list
  equipe/page.tsx                    -- Team management

app/api/
  commerciaux/route.ts               -- GET list, POST create
  commerciaux/[id]/route.ts          -- GET, PUT, DELETE
  activites/route.ts                 -- GET (by client_id), POST create
  activites/[id]/route.ts            -- PUT, DELETE
  commandes/route.ts                 -- GET (with filters), POST create
  commandes/[id]/route.ts            -- PUT, DELETE
  poses/route.ts                     -- GET (with filters), POST create
  poses/[id]/route.ts                -- PUT, DELETE
  sav/route.ts                       -- GET (with filters), POST create
  sav/[id]/route.ts                  -- PUT, DELETE
  leads/import/route.ts              -- POST: AI extraction from raw text
  pipeline/route.ts                  -- GET: pipeline data with counts + alerts
```

### Modified Files

```
app/(admin)/layout.tsx               -- Replace top nav with sidebar
app/(admin)/page.tsx                 -- Redirect to /pipeline
app/(admin)/clients/[id]/page.tsx    -- Rewrite as rich fiche client
middleware.ts                        -- Add new API routes to public paths if needed
```

---

## Task 1: Database Migrations

**Files:**
- No local files — uses Supabase MCP `apply_migration` tool

- [ ] **Step 1: Create `commerciaux` table**

```sql
CREATE TABLE commerciaux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  telephone text,
  email text,
  couleur text DEFAULT '#3b82f6',
  actif boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE commerciaux ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON commerciaux FOR ALL USING (true);

INSERT INTO commerciaux (nom, couleur) VALUES
  ('Yacine', '#3b82f6'),
  ('Karim', '#10b981'),
  ('Jdis', '#f59e0b'),
  ('Samir', '#8b5cf6');
```

- [ ] **Step 2: Create `activites` table**

```sql
CREATE TABLE activites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  commercial_id uuid REFERENCES commerciaux(id),
  type text NOT NULL CHECK (type IN ('appel','note','rappel','email','visite','relance')),
  contenu text,
  date_prevue timestamptz,
  date_faite timestamptz,
  fait boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_activites_client ON activites(client_id);
CREATE INDEX idx_activites_commercial ON activites(commercial_id);
CREATE INDEX idx_activites_date_prevue ON activites(date_prevue) WHERE fait = false;

ALTER TABLE activites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON activites FOR ALL USING (true);
```

- [ ] **Step 3: Create `commandes` table**

```sql
CREATE TABLE commandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  devis_id uuid REFERENCES devis(id),
  fournisseur text NOT NULL,
  reference_commande text,
  designation text,
  date_commande date,
  delai_prevu text,
  date_livraison_prevue date,
  date_livraison_reelle date,
  status text DEFAULT 'en_attente' CHECK (status IN ('en_attente','commandee','en_fabrication','expediee','livree')),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_commandes_client ON commandes(client_id);
CREATE INDEX idx_commandes_status ON commandes(status);

ALTER TABLE commandes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON commandes FOR ALL USING (true);
```

- [ ] **Step 4: Create `poses` table**

```sql
CREATE TABLE poses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  commande_id uuid REFERENCES commandes(id),
  commercial_id uuid REFERENCES commerciaux(id),
  adresse text,
  date_pose date,
  heure_debut time,
  duree_estimee text,
  status text DEFAULT 'planifiee' CHECK (status IN ('planifiee','en_cours','terminee','reportee')),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_poses_date ON poses(date_pose);
CREATE INDEX idx_poses_commercial ON poses(commercial_id);

ALTER TABLE poses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON poses FOR ALL USING (true);
```

- [ ] **Step 5: Create `sav_tickets` table**

```sql
CREATE TABLE sav_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  commercial_id uuid REFERENCES commerciaux(id),
  sujet text NOT NULL,
  description text,
  priorite text DEFAULT 'moyenne' CHECK (priorite IN ('urgente','haute','moyenne','basse')),
  status text DEFAULT 'ouvert' CHECK (status IN ('ouvert','en_cours','resolu','ferme')),
  date_resolution timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_sav_client ON sav_tickets(client_id);
CREATE INDEX idx_sav_status ON sav_tickets(status);

ALTER TABLE sav_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON sav_tickets FOR ALL USING (true);
```

- [ ] **Step 6: Add columns to `clients` table**

```sql
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS commercial_id uuid REFERENCES commerciaux(id),
  ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'nouveau',
  ADD COLUMN IF NOT EXISTS besoin text,
  ADD COLUMN IF NOT EXISTS montant_estime numeric,
  ADD COLUMN IF NOT EXISTS priorite text DEFAULT 'moyenne',
  ADD COLUMN IF NOT EXISTS perdu_raison text;

CREATE INDEX idx_clients_pipeline ON clients(pipeline_stage);
CREATE INDEX idx_clients_commercial ON clients(commercial_id);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 7: Verify all tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected: clients, commerciaux, activites, commandes, devis, messages, otp_codes, payments, poses, sav_tickets, signatures, templates

- [ ] **Step 8: Commit**

```bash
# Nothing to commit locally — migrations are in Supabase
```

---

## Task 2: API Routes — Commerciaux

**Files:**
- Create: `app/api/commerciaux/route.ts`
- Create: `app/api/commerciaux/[id]/route.ts`

- [ ] **Step 1: Create commerciaux list + create API**

Create `app/api/commerciaux/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('commerciaux')
    .select('*')
    .order('nom')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase
    .from('commerciaux')
    .insert({ nom: body.nom, telephone: body.telephone || null, email: body.email || null, couleur: body.couleur || '#3b82f6' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 2: Create commerciaux detail API**

Create `app/api/commerciaux/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase
    .from('commerciaux')
    .update(body)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('commerciaux').update({ actif: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Verify API works**

```bash
curl -s http://localhost:3000/api/commerciaux | head
```

- [ ] **Step 4: Commit**

```bash
git add app/api/commerciaux/
git commit -m "feat: add commerciaux API routes"
```

---

## Task 3: API Routes — Activites, Commandes, Poses, SAV

**Files:**
- Create: `app/api/activites/route.ts`
- Create: `app/api/activites/[id]/route.ts`
- Create: `app/api/commandes/route.ts`
- Create: `app/api/commandes/[id]/route.ts`
- Create: `app/api/poses/route.ts`
- Create: `app/api/poses/[id]/route.ts`
- Create: `app/api/sav/route.ts`
- Create: `app/api/sav/[id]/route.ts`

- [ ] **Step 1: Create activites API**

Create `app/api/activites/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const clientId = request.nextUrl.searchParams.get('client_id')
  const commercialId = request.nextUrl.searchParams.get('commercial_id')
  const pending = request.nextUrl.searchParams.get('pending')

  let query = supabase.from('activites').select('*, clients(nom), commerciaux(nom)')

  if (clientId) query = query.eq('client_id', clientId)
  if (commercialId) query = query.eq('commercial_id', commercialId)
  if (pending === 'true') query = query.eq('fait', false).not('date_prevue', 'is', null)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase
    .from('activites')
    .insert({
      client_id: body.client_id,
      commercial_id: body.commercial_id || null,
      type: body.type,
      contenu: body.contenu || null,
      date_prevue: body.date_prevue || null,
      fait: body.fait || false,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

Create `app/api/activites/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase.from('activites').update(body).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('activites').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Create commandes API**

Create `app/api/commandes/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const clientId = request.nextUrl.searchParams.get('client_id')
  const status = request.nextUrl.searchParams.get('status')
  const fournisseur = request.nextUrl.searchParams.get('fournisseur')

  let query = supabase.from('commandes').select('*, clients(nom, telephone)')

  if (clientId) query = query.eq('client_id', clientId)
  if (status) query = query.eq('status', status)
  if (fournisseur) query = query.eq('fournisseur', fournisseur)

  const { data, error } = await query.order('date_livraison_prevue', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase
    .from('commandes')
    .insert({
      client_id: body.client_id,
      devis_id: body.devis_id || null,
      fournisseur: body.fournisseur,
      reference_commande: body.reference_commande || null,
      designation: body.designation || null,
      date_commande: body.date_commande || null,
      delai_prevu: body.delai_prevu || null,
      date_livraison_prevue: body.date_livraison_prevue || null,
      status: body.status || 'en_attente',
      notes: body.notes || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

Create `app/api/commandes/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase.from('commandes').update(body).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('commandes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Create poses API**

Create `app/api/poses/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const commercialId = request.nextUrl.searchParams.get('commercial_id')
  const status = request.nextUrl.searchParams.get('status')

  let query = supabase.from('poses').select('*, clients(nom, telephone, adresse), commerciaux(nom), commandes(designation)')

  if (commercialId) query = query.eq('commercial_id', commercialId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query.order('date_pose', { ascending: true, nullsFirst: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase
    .from('poses')
    .insert({
      client_id: body.client_id,
      commande_id: body.commande_id || null,
      commercial_id: body.commercial_id || null,
      adresse: body.adresse || null,
      date_pose: body.date_pose || null,
      heure_debut: body.heure_debut || null,
      duree_estimee: body.duree_estimee || null,
      status: body.status || 'planifiee',
      notes: body.notes || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

Create `app/api/poses/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase.from('poses').update(body).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('poses').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 4: Create SAV API**

Create `app/api/sav/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const clientId = request.nextUrl.searchParams.get('client_id')
  const status = request.nextUrl.searchParams.get('status')
  const priorite = request.nextUrl.searchParams.get('priorite')
  const commercialId = request.nextUrl.searchParams.get('commercial_id')

  let query = supabase.from('sav_tickets').select('*, clients(nom, telephone), commerciaux(nom)')

  if (clientId) query = query.eq('client_id', clientId)
  if (status) query = query.eq('status', status)
  if (priorite) query = query.eq('priorite', priorite)
  if (commercialId) query = query.eq('commercial_id', commercialId)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const body = await request.json()
  const { data, error } = await supabase
    .from('sav_tickets')
    .insert({
      client_id: body.client_id,
      commercial_id: body.commercial_id || null,
      sujet: body.sujet,
      description: body.description || null,
      priorite: body.priorite || 'moyenne',
      status: 'ouvert',
      notes: body.notes || null,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

Create `app/api/sav/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const body = await request.json()
  if (body.status === 'resolu' && !body.date_resolution) {
    body.date_resolution = new Date().toISOString()
  }
  const { data, error } = await supabase.from('sav_tickets').update(body).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { error } = await supabase.from('sav_tickets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 5: Commit all API routes**

```bash
git add app/api/activites/ app/api/commandes/ app/api/poses/ app/api/sav/
git commit -m "feat: add API routes for activites, commandes, poses, SAV"
```

---

## Task 4: Pipeline API

**Files:**
- Create: `app/api/pipeline/route.ts`

- [ ] **Step 1: Create pipeline API**

This endpoint returns all active clients grouped by pipeline stage, with alert data computed server-side.

Create `app/api/pipeline/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const commercialId = request.nextUrl.searchParams.get('commercial_id')

  let query = supabase
    .from('clients')
    .select('*, commerciaux(nom, couleur), devis(id, reference, status, montant_ttc, sent_at, signed_at, payment_status)')
    .not('pipeline_stage', 'eq', 'termine')
    .not('pipeline_stage', 'eq', 'perdu')
    .order('created_at', { ascending: false })

  if (commercialId) query = query.eq('commercial_id', commercialId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Compute alerts for each client
  const now = new Date()
  const enriched = (data || []).map((client: Record<string, unknown>) => {
    const devisList = (client.devis || []) as Record<string, unknown>[]
    const alerts: string[] = []

    // Alert: new lead not contacted in 24h
    if (client.pipeline_stage === 'nouveau') {
      const created = new Date(client.created_at as string)
      const hours = (now.getTime() - created.getTime()) / (1000 * 60 * 60)
      if (hours > 24) alerts.push('a_contacter')
    }

    // Alert: devis sent without response
    const sentDevis = devisList.filter((d) => d.status === 'envoye' || d.status === 'lu')
    for (const d of sentDevis) {
      if (d.sent_at) {
        const sentDate = new Date(d.sent_at as string)
        const days = (now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24)
        if (days > 7) alerts.push('relance_urgente')
        else if (days > 3) alerts.push('a_relancer')
      }
    }

    // Latest devis amount
    const lastDevis = devisList.sort((a, b) =>
      new Date(b.sent_at as string || b.signed_at as string || '').getTime() -
      new Date(a.sent_at as string || a.signed_at as string || '').getTime()
    )[0]

    return {
      ...client,
      alerts,
      montant_devis: lastDevis ? Number(lastDevis.montant_ttc) : null,
      devis_count: devisList.length,
    }
  })

  return NextResponse.json(enriched)
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/pipeline/
git commit -m "feat: add pipeline API with alert computation"
```

---

## Task 5: Sidebar Layout

**Files:**
- Modify: `app/(admin)/layout.tsx`

- [ ] **Step 1: Rewrite layout with sidebar**

Replace the entire content of `app/(admin)/layout.tsx` with a sidebar layout. The sidebar has: Pipeline, Clients, Livraisons, Planning, SAV, Équipe links. At the bottom: Devis link (existing) and logout. A relance counter badge on the Pipeline link. Mobile-responsive with hamburger menu.

Key structure:
- Fixed sidebar on the left (w-64, hidden on mobile)
- Main content area on the right with padding
- Each nav item: icon + label + optional badge
- Active state with bg highlight
- Logo "RENOV-R 91" at top of sidebar
- User name + logout at bottom

The sidebar should fetch `/api/pipeline` to count alerts and show a badge like "3" next to Pipeline.

- [ ] **Step 2: Update home page to redirect to pipeline**

Modify `app/(admin)/page.tsx` to redirect:

```typescript
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/pipeline')
}
```

- [ ] **Step 3: Verify sidebar renders correctly**

Run locally: `npm run dev`, visit `http://localhost:3000` — should redirect to `/pipeline` with sidebar visible.

- [ ] **Step 4: Commit**

```bash
git add app/\\(admin\\)/layout.tsx app/\\(admin\\)/page.tsx
git commit -m "feat: replace top nav with sidebar layout + redirect home to pipeline"
```

---

## Task 6: Pipeline Kanban Page

**Files:**
- Create: `app/(admin)/pipeline/page.tsx`

- [ ] **Step 1: Create pipeline Kanban page**

Create `app/(admin)/pipeline/page.tsx` — a `'use client'` component.

Key features:
- Fetches from `/api/pipeline` and `/api/commerciaux`
- Groups clients by `pipeline_stage`
- Renders columns for each stage (horizontal scroll on overflow)
- Each card shows: client name, besoin, montant, source badge, commercial name, alert badges
- Filter dropdown by commercial at the top
- "+ Nouveau lead" button opens an inline modal form
- "Coller un message" button opens the AI import modal (Task 10)
- Clicking a card navigates to `/clients/{id}`

Pipeline stages constant (shared across pages):

```typescript
const STAGES = [
  { code: 'nouveau', label: 'Nouveau', color: 'bg-blue-100 text-blue-800', headerBg: 'bg-blue-200' },
  { code: 'contacte', label: 'Contacté', color: 'bg-yellow-100 text-yellow-800', headerBg: 'bg-yellow-200' },
  { code: 'visite', label: 'Visite', color: 'bg-indigo-100 text-indigo-800', headerBg: 'bg-indigo-200' },
  { code: 'devis_envoye', label: 'Devis envoyé', color: 'bg-orange-100 text-orange-800', headerBg: 'bg-orange-200' },
  { code: 'signe', label: 'Signé', color: 'bg-green-100 text-green-800', headerBg: 'bg-green-200' },
  { code: 'commande', label: 'Commandé', color: 'bg-purple-100 text-purple-800', headerBg: 'bg-purple-200' },
  { code: 'livre', label: 'Livré', color: 'bg-violet-100 text-violet-800', headerBg: 'bg-violet-200' },
  { code: 'pose', label: 'Posé', color: 'bg-teal-100 text-teal-800', headerBg: 'bg-teal-200' },
]
```

Each card: dropdown to move to next/previous stage (since no drag & drop in V1).

Source badge colors:
```typescript
const SOURCE_COLORS: Record<string, string> = {
  leboncoin: 'bg-amber-100 text-amber-800',
  telephone: 'bg-blue-100 text-blue-800',
  email: 'bg-pink-100 text-pink-800',
  'bouche a oreille': 'bg-green-100 text-green-800',
  site_web: 'bg-cyan-100 text-cyan-800',
}
```

Alert badge rendering:
- `a_contacter` → red badge "À contacter"
- `a_relancer` → amber badge "Relance 3j"
- `relance_urgente` → red badge "Urgent 7j+"

- [ ] **Step 2: Test pipeline page**

Visit `http://localhost:3000/pipeline` — should show empty columns (no clients have `pipeline_stage` set yet).

- [ ] **Step 3: Commit**

```bash
git add app/\\(admin\\)/pipeline/
git commit -m "feat: add pipeline Kanban page with filters and alerts"
```

---

## Task 7: Enhanced Client Detail Page (Fiche Client)

**Files:**
- Rewrite: `app/(admin)/clients/[id]/page.tsx`

- [ ] **Step 1: Rewrite client detail page**

Replace `app/(admin)/clients/[id]/page.tsx` with a rich fiche client. `'use client'` component.

Layout: 2 columns on desktop (lg:grid-cols-3).

**Left column (lg:col-span-2):**
- Client header: name, pipeline stage dropdown, priority badge
- Tabs: Activités | Devis | Commandes | SAV
- **Activités tab:** timeline of activities (type icon + content + date). Button "Ajouter une note", "Planifier un rappel". Fetches from `/api/activites?client_id={id}`
- **Devis tab:** list of devis linked to this client (reference, status badge, montant, PDF links). Fetches from `/api/devis` filtered by client.
- **Commandes tab:** list of commandes (fournisseur, designation, status, dates). Fetches from `/api/commandes?client_id={id}`. Button "Nouvelle commande".
- **SAV tab:** list of SAV tickets (sujet, priorité, status). Fetches from `/api/sav?client_id={id}`. Button "Nouveau ticket".

**Right column (lg:col-span-1):**
- Client info card: nom, telephone (clickable tel: link), email, adresse — each field editable inline
- Commercial assigné: dropdown fetched from `/api/commerciaux`
- Source du lead: dropdown (LeBonCoin, Téléphone, Email, Bouche à oreille, Site web, Autre)
- Besoin: textarea
- Montant estimé: number input
- Prochaine action: show next pending activité (rappel/visite)
- Quick action buttons:
  - Ajouter une note → opens inline form
  - Planifier un rappel → opens inline form with date picker
  - Créer un devis → navigates to `/devis/nouveau?client_id={id}`
  - Passer une commande → opens inline form
  - Planifier une pose → opens inline form

Each inline form: simple modal or expandable section with the required fields and a save button.

- [ ] **Step 2: Update client API to include new fields**

Modify `app/api/clients/[id]/route.ts` to handle the new fields (commercial_id, pipeline_stage, besoin, montant_estime, priorite, perdu_raison) in the PUT handler. The existing handler likely does a generic update, so it may already work — verify.

- [ ] **Step 3: Test client detail page**

Visit a client page — verify tabs work, activities load, quick actions function.

- [ ] **Step 4: Commit**

```bash
git add app/\\(admin\\)/clients/\\[id\\]/page.tsx app/api/clients/
git commit -m "feat: rewrite client detail page with tabs, activities, quick actions"
```

---

## Task 8: Livraisons Page

**Files:**
- Create: `app/(admin)/livraisons/page.tsx`

- [ ] **Step 1: Create livraisons page**

Create `app/(admin)/livraisons/page.tsx` — `'use client'` component.

Features:
- Fetches from `/api/commandes` (all non-livree commandes by default)
- Table with columns: Client, Fournisseur, Produits, Commandé le, Livraison prévue, Statut
- Filters: fournisseur dropdown (Flexidoor, David Fermeture, Wibaie PVC, Wibaie ALU, Univers), status dropdown
- Click on a row → navigate to client detail
- Inline status update dropdown on each row (en_attente → commandee → en_fabrication → expediee → livree)
- Color-coded status badges
- Sorted by date_livraison_prevue ascending (most urgent first)
- Overdue deliveries highlighted in red (date_livraison_prevue < today and status != livree)

Status labels:
```typescript
const COMMANDE_STATUS: Record<string, { label: string; color: string }> = {
  en_attente: { label: 'En attente', color: 'bg-gray-100 text-gray-700' },
  commandee: { label: 'Commandée', color: 'bg-blue-100 text-blue-700' },
  en_fabrication: { label: 'En fabrication', color: 'bg-amber-100 text-amber-700' },
  expediee: { label: 'Expédiée', color: 'bg-purple-100 text-purple-700' },
  livree: { label: 'Livrée', color: 'bg-green-100 text-green-700' },
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\\(admin\\)/livraisons/
git commit -m "feat: add livraisons tracking page"
```

---

## Task 9: Planning Poses Page

**Files:**
- Create: `app/(admin)/planning/page.tsx`

- [ ] **Step 1: Create planning page**

Create `app/(admin)/planning/page.tsx` — `'use client'` component.

Features:
- Fetches from `/api/poses`
- Table view with columns: Date, Heure, Client, Adresse, Produits (from commande), Poseur, Statut
- Filter by poseur/commercial, by week (date range picker or prev/next week buttons)
- Inline status update (planifiee → en_cours → terminee / reportee)
- Color coding: today's poses highlighted, past unfinished in red, future in default
- Button "+ Nouvelle pose" opens inline form (client dropdown, date, heure, adresse, poseur)

Status labels:
```typescript
const POSE_STATUS: Record<string, { label: string; color: string }> = {
  planifiee: { label: 'Planifiée', color: 'bg-blue-100 text-blue-700' },
  en_cours: { label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  terminee: { label: 'Terminée', color: 'bg-green-100 text-green-700' },
  reportee: { label: 'Reportée', color: 'bg-red-100 text-red-700' },
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\\(admin\\)/planning/
git commit -m "feat: add pose planning page"
```

---

## Task 10: SAV Page

**Files:**
- Create: `app/(admin)/sav/page.tsx`

- [ ] **Step 1: Create SAV page**

Create `app/(admin)/sav/page.tsx` — `'use client'` component.

Features:
- Fetches from `/api/sav`
- Table with columns: #, Client, Sujet, Priorité, Assigné à, Statut, Créé le
- Filters: statut (ouvert/en_cours/resolu/ferme), priorité (urgente/haute/moyenne/basse), commercial
- Button "+ Nouveau ticket" opens inline form
- Click row → expand to show description + notes, with edit capability
- Priority badges with colors:

```typescript
const PRIORITE_COLORS: Record<string, string> = {
  urgente: 'bg-red-100 text-red-700',
  haute: 'bg-orange-100 text-orange-700',
  moyenne: 'bg-yellow-100 text-yellow-700',
  basse: 'bg-gray-100 text-gray-700',
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\\(admin\\)/sav/
git commit -m "feat: add SAV ticket management page"
```

---

## Task 11: Équipe Page

**Files:**
- Create: `app/(admin)/equipe/page.tsx`

- [ ] **Step 1: Create equipe page**

Create `app/(admin)/equipe/page.tsx` — `'use client'` component.

Features:
- Fetches from `/api/commerciaux`
- Cards for each commercial showing:
  - Name, phone, email
  - Color indicator (their Kanban color)
  - Stats (fetched via separate queries):
    - Leads actifs (count from clients where commercial_id = this and pipeline_stage not in (termine, perdu))
    - CA signé ce mois (sum montant_ttc from devis where status = signe and client's commercial_id = this and signed_at this month)
    - Devis en attente (count devis where status in (envoye, lu) and client's commercial_id = this)
- Button "Ajouter un commercial" → simple inline form (nom, telephone, email, couleur picker)
- Edit button on each card → same form pre-filled

Stats API: add a `/api/commerciaux/stats` endpoint or compute client-side from existing data. Client-side is simpler for V1 — fetch all clients and devis, group by commercial_id.

- [ ] **Step 2: Commit**

```bash
git add app/\\(admin\\)/equipe/
git commit -m "feat: add team management page with stats"
```

---

## Task 12: AI Lead Import

**Files:**
- Create: `app/api/leads/import/route.ts`

- [ ] **Step 1: Create AI import API**

Create `app/api/leads/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { message } = await request.json()
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message requis' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY manquante' }, { status: 500 })
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Extrais les informations de contact de ce message client. Réponds UNIQUEMENT en JSON valide, sans texte autour. Si un champ n'est pas trouvé, mets null.

Format attendu:
{"nom": "...", "telephone": "...", "email": "...", "adresse": "...", "code_postal": "...", "ville": "...", "besoin": "...", "source": "leboncoin|email|telephone|autre"}

Message:
${message}`
      }],
    }),
  })

  if (!resp.ok) {
    return NextResponse.json({ error: 'Erreur API IA' }, { status: 500 })
  }

  const result = await resp.json()
  const text = result.content?.[0]?.text || '{}'

  try {
    const extracted = JSON.parse(text)
    return NextResponse.json(extracted)
  } catch {
    return NextResponse.json({ error: 'Réponse IA invalide', raw: text }, { status: 500 })
  }
}
```

- [ ] **Step 2: Add import modal to pipeline page**

Add a modal component in the pipeline page that:
1. Shows a textarea "Collez le message du client"
2. On submit, calls `/api/leads/import`
3. Shows extracted fields in a pre-filled form
4. User validates/edits → calls POST `/api/clients` to create
5. New client appears in the "Nouveau" column

- [ ] **Step 3: Commit**

```bash
git add app/api/leads/ app/\\(admin\\)/pipeline/
git commit -m "feat: add AI-powered lead import from pasted messages"
```

---

## Task 13: Client List Page Update

**Files:**
- Modify: `app/(admin)/clients/page.tsx`

- [ ] **Step 1: Update client list with new fields**

Update the existing clients list page to show:
- Pipeline stage badge
- Commercial assigné
- Source badge
- Search by name or telephone
- Filter by pipeline stage, by commercial

Keep the existing structure but add the new columns and filters.

- [ ] **Step 2: Update nouveau client form**

Update `app/(admin)/clients/nouveau/page.tsx` to include:
- Source dropdown (LeBonCoin, Téléphone, Email, Bouche à oreille, Site web, Autre)
- Commercial assigné dropdown (fetched from `/api/commerciaux`)
- Besoin textarea
- Pipeline stage defaults to 'nouveau'

- [ ] **Step 3: Commit**

```bash
git add app/\\(admin\\)/clients/
git commit -m "feat: update client list and create form with pipeline/commercial fields"
```

---

## Task 14: Deploy and Verify

- [ ] **Step 1: Build locally**

```bash
cd /Users/elpatroneee/Crm-menuiserie
npm run build
```

Fix any TypeScript or build errors.

- [ ] **Step 2: Deploy to Vercel**

```bash
npx vercel --prod
```

- [ ] **Step 3: Verify all pages**

Check each page works on production:
- `/pipeline` — Kanban loads, filters work
- `/clients` — list with new columns
- `/clients/{id}` — fiche client with tabs
- `/livraisons` — commandes table
- `/planning` — poses table
- `/sav` — tickets table
- `/equipe` — team cards with stats

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: CRM menuiserie V1 complete — pipeline, clients, livraisons, planning, SAV, equipe"
```
