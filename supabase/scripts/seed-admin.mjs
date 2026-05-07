// =============================================================================
// seed-admin.mjs — crea (o promueve) un usuario admin en Supabase Auth.
//
// USO:
//   1) Asegúrate de tener en next-app/.env.local (o exporta en shell):
//        NEXT_PUBLIC_SUPABASE_URL=https://...
//        SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   (NO el anon/publishable key)
//      La service role key se obtiene en Supabase Dashboard
//        → Settings → API → service_role (secret)
//   2) Desde la raíz del proyecto:
//        cd next-app
//        node ../supabase/scripts/seed-admin.mjs admin@correo.com 'Password!'
//
// Comportamiento:
//   - Si el usuario no existe, lo crea con email confirmado.
//   - El trigger trg_on_auth_user_created (schema.sql) auto-crea el profile.
//   - Después actualizamos profile.role = 'admin'.
//   - Si el usuario ya existe, solo promueve su profile a admin.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carga .env.local si existe (no requiere dotenv como dependencia).
function loadEnvLocal() {
  const path = resolve(__dirname, "../../next-app/.env.local");
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // sin .env.local — depende de variables ya exportadas
  }
}

loadEnvLocal();

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("Uso: node supabase/scripts/seed-admin.mjs <email> <password>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Pon SUPABASE_SERVICE_ROLE_KEY en next-app/.env.local o exportala en shell.");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // ¿Ya existe?
  const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;
  let user = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (!user) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    user = created.user;
    console.log(`✓ Usuario creado: ${user.email} (id=${user.id})`);
  } else {
    console.log(`• Usuario ya existía: ${user.email} (id=${user.id})`);
  }

  // Promueve a admin (el trigger pudo dejarlo en 'user' por default).
  const { error: updErr } = await admin
    .from("profile")
    .update({ role: "admin", email: user.email })
    .eq("id", user.id);
  if (updErr) {
    // Quizás el trigger no corrió (raro pero posible) — intentamos upsert.
    const { error: upsertErr } = await admin.from("profile").upsert({
      id: user.id,
      email: user.email,
      role: "admin",
    });
    if (upsertErr) throw upsertErr;
  }

  console.log(`✓ profile.role = 'admin' para ${user.email}`);
  console.log("\nListo. Inicia sesión en http://localhost:3000/login con esas credenciales.");
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
