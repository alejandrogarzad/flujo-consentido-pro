import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// updateSession: refresca el token de Supabase en cada request y propaga las
// cookies actualizadas a la response. El middleware raíz lo invoca para que
// los Server Components no tengan que preocuparse por cookies expiradas.
//
// Si las env vars de Supabase no están definidas (típico al clonar el repo
// antes de configurar `.env.local`), simplemente saltamos sin tocar la
// request — así la home renderiza y el usuario puede leer el README sin un
// 500 de fondo. La auth real fallará después, pero con un mensaje claro.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return supabaseResponse;

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // No quitar este getUser() — refresca el access token si está por expirar.
  await supabase.auth.getUser();

  return supabaseResponse;
}
