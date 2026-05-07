// =============================================================================
// db.ts — Adaptador con la misma firma que `base44.entities.X`.
//
// El objetivo es minimizar el diff al migrar las páginas: cada página solo
// cambia `import { base44 } from "@/api/base44Client"` por
// `import { db } from "@/lib/db"` y usa `db.paciente.list()` igual que antes.
//
// Contrato preservado (por entidad):
//   .list(orderBy?, limit?)            — orderBy con prefijo "-" para DESC
//   .filter(where, orderBy?, limit?)   — equality match (sin operadores gt/lt)
//   .get(id)
//   .create(data)                      — devuelve la fila creada
//   .update(id, data)                  — devuelve la fila actualizada
//   .delete(id)
//   .subscribe(callback)               — realtime; devuelve unsubscribe()
//
// Auth y functions:
//   db.auth.me() / .signOut() / .signInWithPassword()
//   db.users.inviteUser(email, baseRole) — vía Service Role en API Route
//   db.functions.invoke(name, payload)
//
// Este módulo es client-side por default (usa createBrowserClient). Para
// llamarlo desde Server Components se puede crear un wrapper análogo en
// `db.server.ts` cuando se necesite. Por ahora todas las páginas son
// 'use client' (Fase 4 inicial), igual que la app original.
// =============================================================================

"use client";

import { createClient } from "@/lib/supabase/client";
import type { TableMap, TableName, AppRole, Profile } from "@/types/db";
import type { RealtimeChannel } from "@supabase/supabase-js";

const supabase = createClient();

// ---------- Helpers internos --------------------------------------------------

// Parsea el orderBy estilo Base44 ("-fecha" => col=fecha, desc=true).
function parseOrderBy(orderBy?: string): { col: string; ascending: boolean } | null {
  if (!orderBy) return null;
  const desc = orderBy.startsWith("-");
  return { col: desc ? orderBy.slice(1) : orderBy, ascending: !desc };
}

// Aplica filtros de equality. Soporta el subset que la app original usaba
// (ningún caso requiere operadores gt/lt en el código actual; si después
// hace falta, expandir aquí).
function applyFilters<T extends object>(
  query: ReturnType<ReturnType<typeof createClient>["from"]>["select"] extends (...args: any[]) => infer Q ? Q : never,
  where: Partial<T>,
) {
  let q = query as any;
  for (const [key, value] of Object.entries(where)) {
    if (value === null) {
      q = q.is(key, null);
    } else {
      q = q.eq(key, value);
    }
  }
  return q;
}

// ---------- Builder genérico de entidad --------------------------------------

interface EntityApi<Row> {
  list(orderBy?: string, limit?: number): Promise<Row[]>;
  filter(where: Partial<Row>, orderBy?: string, limit?: number): Promise<Row[]>;
  get(id: string): Promise<Row | null>;
  create(data: Partial<Row>): Promise<Row>;
  update(id: string, data: Partial<Row>): Promise<Row>;
  delete(id: string): Promise<void>;
  subscribe(callback: () => void): () => void;
}

function buildEntity<K extends TableName>(table: K): EntityApi<TableMap[K]> {
  type Row = TableMap[K];

  return {
    async list(orderBy = "-created_date", limit) {
      let q = supabase.from(table).select("*") as any;
      const ord = parseOrderBy(orderBy);
      if (ord) q = q.order(ord.col, { ascending: ord.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },

    async filter(where, orderBy = "-created_date", limit) {
      let q = supabase.from(table).select("*") as any;
      q = applyFilters(q, where);
      const ord = parseOrderBy(orderBy);
      if (ord) q = q.order(ord.col, { ascending: ord.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },

    async get(id) {
      const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Row | null;
    },

    async create(data) {
      const { data: row, error } = await supabase
        .from(table)
        .insert(data as any)
        .select("*")
        .single();
      if (error) throw error;
      return row as Row;
    },

    async update(id, data) {
      const { data: row, error } = await supabase
        .from(table)
        .update(data as any)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return row as Row;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },

    subscribe(callback) {
      const channel: RealtimeChannel = supabase
        .channel(`${table}-changes-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => callback(),
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    },
  };
}

// ---------- Auth (db.auth.me / signIn / signOut) -----------------------------

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
}

const auth = {
  async me(): Promise<AuthUser | null> {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    const { data: profile } = await supabase
      .from("profile")
      .select("*")
      .eq("id", user.id)
      .maybeSingle<Profile>();
    return {
      id: user.id,
      email: profile?.email ?? user.email ?? "",
      full_name: profile?.full_name ?? null,
      role: profile?.role ?? "user",
    };
  },

  async signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  async signOut(redirectUrl?: string) {
    await supabase.auth.signOut();
    if (redirectUrl && typeof window !== "undefined") {
      window.location.href = redirectUrl;
    }
  },
};

// ---------- Users (invite con custom role) -----------------------------------

const users = {
  // Invita a un usuario y le asigna un rol (incluyendo custom roles como
  // cap_terapias). Se ejecuta server-side vía API Route porque requiere
  // Service Role para `auth.admin.inviteUserByEmail`.
  async inviteUser(email: string, role: AppRole = "user") {
    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Invite failed (${res.status})`);
    }
    return res.json();
  },
};

// ---------- Functions (Edge Functions de Supabase) ---------------------------

const functions = {
  async invoke<T = unknown>(name: string, payload?: object): Promise<{ data: T }> {
    const { data, error } = await supabase.functions.invoke<T>(name, {
      body: payload ?? {},
    });
    if (error) throw error;
    return { data: data as T };
  },
};

// ---------- API pública --------------------------------------------------------

export const db = {
  auth,
  users,
  functions,
  // Entidades — mismas claves que en Base44 pero en snake_case (igual a tabla)
  paciente: buildEntity("paciente"),
  empleado: buildEntity("empleado"),
  calendario_paciente: buildEntity("calendario_paciente"),
  sesion_mensual: buildEntity("sesion_mensual"),
  pago_terapia: buildEntity("pago_terapia"),
  evento: buildEntity("evento"),
  gasto: buildEntity("gasto"),
  horario_terapeuta: buildEntity("horario_terapeuta"),
  nomina_mensual: buildEntity("nomina_mensual"),
  subarrendamiento: buildEntity("subarrendamiento"),
  resumen_ingreso: buildEntity("resumen_ingreso"),
  parametro: buildEntity("parametro"),
  profile: buildEntity("profile"),
};

// ---------- Compat con código original ---------------------------------------
// La app original usaba `base44.entities.Paciente` (PascalCase). Para que la
// migración de cada página sea un cambio simple de import + path, exportamos
// también un alias `entities` con los mismos nombres en PascalCase.
export const entities = {
  Paciente: db.paciente,
  Empleado: db.empleado,
  CalendarioPaciente: db.calendario_paciente,
  SesionMensual: db.sesion_mensual,
  PagoTerapia: db.pago_terapia,
  Evento: db.evento,
  Gasto: db.gasto,
  HorarioTerapeuta: db.horario_terapeuta,
  NominaMensual: db.nomina_mensual,
  Subarrendamiento: db.subarrendamiento,
  ResumenIngreso: db.resumen_ingreso,
  Parametro: db.parametro,
  Profile: db.profile,
};
