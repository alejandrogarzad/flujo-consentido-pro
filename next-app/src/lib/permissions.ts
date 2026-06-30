// =============================================================================
// permissions.ts — Reglas de acceso por rol (D13: refinamiento de Fase 6.5).
//
// La capa de DB todavía usa "authenticated full access" (RLS plana). Estas
// reglas se aplican en cliente para esconder UI y redirigir rutas, y en el
// servidor vía middleware para bloquear acceso directo a páginas no permitidas.
// =============================================================================

import type { AppRole } from "@/types/db";

// Rutas a las que cada rol tiene acceso. `null` = acceso total.
const ALLOWED_PATHS: Record<AppRole, string[] | null> = {
  admin: null,        // todo
  user: null,         // todo (legacy, se trata como admin)
  cap_terapias: ["/captura-terapias"],
  cap_pagos: ["/cobranza", "/citas-evaluaciones"],
  cap_gastos: ["/captura-gasto"],
  // El contador (rol de solo lectura) entra exclusivamente a "Para el
  // Contador" para descargar la declaración mensual. Nada más.
  contador: ["/para-contador"],
};

export function canAccess(role: AppRole | null | undefined, path: string): boolean {
  if (!role) return false;
  const allowed = ALLOWED_PATHS[role];
  if (allowed === null) return true;
  return allowed.some((p) => path === p || path.startsWith(`${p}/`));
}

export function defaultPathFor(role: AppRole | null | undefined): string {
  if (!role) return "/login";
  const allowed = ALLOWED_PATHS[role];
  if (allowed === null) return "/dashboard";
  return allowed[0] ?? "/dashboard";
}

// Permisos finos por feature dentro de Cobranza / CitasEvaluaciones
export function canEditSesiones(role: AppRole | null | undefined): boolean {
  return role !== "cap_pagos"; // cap_pagos solo captura monto/forma de pago
}

export function canDeletePago(role: AppRole | null | undefined): boolean {
  return role !== "cap_pagos";
}

export function canCreateEvento(role: AppRole | null | undefined): boolean {
  return role !== "cap_pagos";
}

export function canEditEvento(role: AppRole | null | undefined): boolean {
  return role !== "cap_pagos"; // cap_pagos solo registra pagos via PagoModal
}

export function canDeleteEvento(role: AppRole | null | undefined): boolean {
  return role !== "cap_pagos";
}
