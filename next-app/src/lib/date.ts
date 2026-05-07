// =============================================================================
// Helper de formato de fechas con locale español por default (D9).
//
// Usar SIEMPRE estas funciones en lugar de `format()` directo de date-fns.
// Si alguna vez se necesita otro locale, se puede pasar por parámetro.
// =============================================================================

import {
  format as dfFormat,
  formatDistance as dfFormatDistance,
  formatRelative as dfFormatRelative,
  parse as dfParse,
  parseISO as dfParseISO,
  type Locale,
} from "date-fns";
import { es } from "date-fns/locale";

const defaultLocale: Locale = es;

export function format(date: Date | number | string, fmt: string, locale: Locale = defaultLocale) {
  const d = typeof date === "string" ? dfParseISO(date) : date;
  return dfFormat(d, fmt, { locale });
}

export function formatDistance(
  date: Date | number | string,
  baseDate: Date | number | string,
  options?: { addSuffix?: boolean; locale?: Locale },
) {
  const d = typeof date === "string" ? dfParseISO(date) : date;
  const base = typeof baseDate === "string" ? dfParseISO(baseDate) : baseDate;
  return dfFormatDistance(d, base, { locale: options?.locale ?? defaultLocale, ...options });
}

export function formatRelative(
  date: Date | number | string,
  baseDate: Date | number | string,
  locale: Locale = defaultLocale,
) {
  const d = typeof date === "string" ? dfParseISO(date) : date;
  const base = typeof baseDate === "string" ? dfParseISO(baseDate) : baseDate;
  return dfFormatRelative(d, base, { locale });
}

export function parse(value: string, fmt: string, refDate: Date = new Date(), locale: Locale = defaultLocale) {
  return dfParse(value, fmt, refDate, { locale });
}

export const parseISO = dfParseISO;

// Atajo: "lunes 15 abril 2026" — patrón típico de la app.
export function fmtFechaLarga(date: Date | string) {
  return format(date, "EEEE d 'de' MMMM yyyy");
}

// Atajo: "15/04/2026"
export function fmtFechaCorta(date: Date | string) {
  return format(date, "dd/MM/yyyy");
}

// Atajo: "abril 2026"
export function fmtMesAnio(date: Date | string) {
  return format(date, "MMMM yyyy");
}
