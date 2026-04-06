# CRM Menuiserie — Auth, Edit, Delete

## 1. Authentication Admin (Supabase Auth)

- **Provider**: Supabase Auth email/password
- **Package**: `@supabase/ssr` for cookie-based session management
- **Login page**: `/login` — email + password form, redirects to `/` on success
- **Middleware**: Next.js middleware protects all `/(admin)` routes; redirects to `/login` if no session
- **Supabase clients**: server-side client reads cookies; browser client for login form
- **Account creation**: manual via Supabase Dashboard (single admin user)
- **Logout**: button in admin layout header, clears session

## 2. Devis Editing

- **Route**: `/devis/[id]/edit` — reuses creation form logic, pre-filled from existing devis
- **API**: `PUT /api/devis/[id]` — updates client info + line items + pose + notes
- **Status rules**:
  - brouillon/envoye → editable (envoye resets to brouillon on save)
  - signe → blocked (API returns 403)
- **Entry point**: "Modifier" button on `/devis/[id]` detail page (hidden if signe)

## 3. Devis Deletion

- **API**: `DELETE /api/devis/[id]` — cascades to signatures table
- **All statuses** allowed for deletion
- **UI**: "Supprimer" button on detail page with confirmation dialog
- **Redirect**: back to `/devis` list after deletion
