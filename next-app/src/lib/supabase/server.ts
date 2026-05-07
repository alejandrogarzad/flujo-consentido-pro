import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente Supabase para Server Components, Server Actions y API Routes.
// Lee/escribe cookies vía next/headers — refresca la sesión transparentemente.
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll falla cuando se llama desde un Server Component (read-only).
            // No es bug: el middleware refresca la sesión y nuestros Server
            // Components solo leen. Silencio el error a propósito.
          }
        },
      },
    },
  );
}

// Cliente con privilegios elevados (Service Role).
// SOLO para API Routes / Server Actions que necesiten bypassear RLS — por
// ejemplo: invitar usuarios (auth.admin.inviteUserByEmail), seeds, scripts.
// NUNCA lo importes desde un Client Component.
export function createServiceRoleClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false },
    },
  );
}
