import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";
import { canAccess, defaultPathFor } from "@/lib/permissions";
import type { AppRole } from "@/types/db";

const PUBLIC_PATHS = ["/login", "/api/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  // Refresca la sesión y obtiene cookies actualizadas en la response.
  const response = await updateSession(request);

  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // updateSession ya manejó la escritura
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verificar role-based path access (cap_pagos solo puede /cobranza y
  // /citas-evaluaciones, etc.). La raíz "/" se permite pasar para que el
  // page.tsx haga su propio redirect.
  if (pathname !== "/") {
    const { data: profile } = await supabase.from("profile").select("role").eq("id", user.id).maybeSingle();
    const role = (profile?.role as AppRole | undefined) ?? "user";
    if (!canAccess(role, pathname)) {
      const target = request.nextUrl.clone();
      target.pathname = defaultPathFor(role);
      target.search = "";
      return NextResponse.redirect(target);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
