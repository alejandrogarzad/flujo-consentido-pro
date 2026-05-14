// =============================================================================
// seed-capturista.mjs — crea un usuario con rol "cap_pagos" para que solo
// pueda capturar la cobranza del mes en curso (y citas/evaluaciones).
//
// USO:
//   node supabase/scripts/seed-capturista.mjs [email-opcional]
//
// Si no pasas email, usa un default. Genera password aleatorio seguro y lo
// imprime al terminar — guárdalo, no se vuelve a mostrar.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const path = resolve(__dirname, "../../next-app/.env.local");
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadEnvLocal();

function genPassword(len = 16) {
  // Excluye chars ambiguos (0/O, 1/l/I) para evitar confusión al dictarla.
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const email = process.argv[2] || "capturista@centroconsentido.com";
const password = genPassword(16);
const role = "cap_pagos";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en next-app/.env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // Si ya existe, solo promueve y rota password
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`✓ Usuario creado: ${user.email}`);
  } else {
    // Rotar password al uno nuevo
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    console.log(`• Usuario ya existía: ${user.email} — password rotada`);
  }

  // Asignar rol cap_pagos en profile
  const { error: upErr } = await admin.from("profile").update({ role, email: user.email }).eq("id", user.id);
  if (upErr) {
    // upsert fallback si el trigger no creó el profile
    const { error: upsErr } = await admin.from("profile").upsert({ id: user.id, email: user.email, role });
    if (upsErr) throw upsErr;
  }
  console.log(`✓ profile.role = '${role}'`);

  console.log("\n========================================");
  console.log("  CREDENCIALES DEL CAPTURISTA");
  console.log("========================================");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`  URL:      https://flujo-consentido-pro.vercel.app/login`);
  console.log("========================================");
  console.log("\n⚠  Guarda el password — no se vuelve a mostrar.");
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
