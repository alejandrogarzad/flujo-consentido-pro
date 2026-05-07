import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/db";

// POST /api/users/invite — invita un usuario por email y le asigna un rol.
// Requiere que el llamante sea admin (verificado vía profile.role).
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: profile } = await supabase.from("profile").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Solo admin puede invitar usuarios" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: AppRole };
  const { email, role = "user" } = body;
  if (!email) return NextResponse.json({ error: "Email requerido" }, { status: 400 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY no configurada" }, { status: 500 });
  }
  const admin = createServiceRoleClient();

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteErr) return NextResponse.json({ error: inviteErr.message }, { status: 400 });

  if (invited?.user?.id) {
    // El trigger crea el profile con role='user' por default; lo promovemos.
    await admin.from("profile").update({ role }).eq("id", invited.user.id);
  }

  return NextResponse.json({ ok: true, user: { id: invited?.user?.id, email: invited?.user?.email, role } });
}
