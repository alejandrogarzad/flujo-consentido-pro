import { createBrowserClient } from "@supabase/ssr";

// Cliente Supabase para usar en Client Components.
// Maneja sesión vía cookies — el browser y los Server Components/Actions
// comparten la misma sesión.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
