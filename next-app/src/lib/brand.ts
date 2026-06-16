/**
 * Paleta de marca Con-sentido, derivada del logo.
 * Cada sección de la app adopta uno de estos colores (modelo "multicolor sin líder",
 * estilo dashboard base44). Los acentos, encabezados e íconos usan el color de su sección.
 */

export type BrandKey = "coral" | "amber" | "teal" | "purple" | "sky" | "green";

export interface BrandColor {
  base: string; // color sólido
  soft: string; // fondo tenue (tints para tarjetas)
  ring: string; // borde tenue
  text: string; // texto legible sobre soft
}

export const BRAND: Record<BrandKey, BrandColor> = {
  coral:  { base: "#F0567A", soft: "#FDEAEF", ring: "#F8C6D2", text: "#B8284A" },
  amber:  { base: "#FBB034", soft: "#FEF2DC", ring: "#FAD99A", text: "#97650C" },
  teal:   { base: "#2BC4AE", soft: "#DCF6F1", ring: "#A6E6DC", text: "#0F7A6A" },
  purple: { base: "#9B5DE5", soft: "#EFE6FB", ring: "#D6BEF4", text: "#6B36B8" },
  sky:    { base: "#43BCEC", soft: "#E0F3FC", ring: "#AEE0F6", text: "#0F76A6" },
  green:  { base: "#5DC97B", soft: "#E2F6E8", ring: "#B2E6C2", text: "#1E7C42" },
};

/** Color asignado a cada ruta del sidebar. */
export const ROUTE_COLOR: Record<string, BrandKey> = {
  "/dashboard": "purple",
  "/pacientes": "sky",
  "/empleados": "coral",
  "/cobranza": "teal",
  "/calendarios": "amber",
  "/citas-evaluaciones": "coral",
  "/subarrendamiento": "sky",
  "/gastos": "coral",
  "/nomina": "teal",
  "/impuestos": "purple",
  "/cxc": "sky",
  "/flujo-efectivo": "green",
  "/horarios-terapeutas": "amber",
  "/resumen-ingresos": "green",
  "/para-contador": "purple",
  "/parametros": "teal",
  "/respaldo": "teal",
  "/usuarios": "coral",
};

export function routeColor(path: string): BrandColor {
  const key = ROUTE_COLOR[path];
  return BRAND[key ?? "purple"];
}

/** Orden cíclico para repartir colores en series (ej. tarjetas de stats). */
export const BRAND_CYCLE: BrandKey[] = ["purple", "sky", "teal", "amber", "coral", "green"];
