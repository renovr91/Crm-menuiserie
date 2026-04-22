import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from './supabase'

interface CommercialInfo {
  id: string
  nom: string
  user_id: string
  email: string | null
}

// Get the currently logged-in commercial from the auth session
export async function getCurrentCommercial(): Promise<CommercialInfo | null> {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          // Read-only in server components/route handlers
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: commercial } = await admin
    .from('commerciaux')
    .select('id, nom, user_id, email')
    .eq('user_id', user.id)
    .single()

  if (commercial) return commercial as CommercialInfo

  // Fallback: admin user (renov.r91@gmail.com) — not linked to a commercial
  // Return a virtual admin entry
  if (user.email === 'renov.r91@gmail.com') {
    return {
      id: 'admin',
      nom: 'Admin',
      user_id: user.id,
      email: user.email,
    }
  }

  return null
}
