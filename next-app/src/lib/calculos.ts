// =============================================================================
// calculos.ts — Lógica de negocio pura.
//
// Migración 1:1 de src/lib/calculos.js sin cambios semánticos. Solo se
// agregaron tipos y se reorganizaron las constantes. Cualquier ajuste a la
// lógica fiscal debe verificarse contra DOF/IMSS/INEGI antes de producción.
// =============================================================================

import type { FormaPago, HorarioSemanal, Paciente } from "@/types/db";

// ---------- Constantes -------------------------------------------------------

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

export const DIAS_SEMANA = [
  "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo",
] as const;

// Tabla ISR Mensual Art. 96 LISR
export interface TramoISR { li: number; ls: number; tasa: number; cuota: number }
export const TARIFA_ISR: TramoISR[] = [
  { li: 0.01,        ls: 8952.49,      tasa: 0.0192, cuota: 0 },
  { li: 8952.50,     ls: 75984.55,     tasa: 0.0640, cuota: 171.88 },
  { li: 75984.56,    ls: 133536.07,    tasa: 0.1088, cuota: 4461.94 },
  { li: 133536.08,   ls: 155229.80,    tasa: 0.1600, cuota: 10723.55 },
  { li: 155229.81,   ls: 185852.57,    tasa: 0.1792, cuota: 14194.54 },
  { li: 185852.58,   ls: 374837.88,    tasa: 0.2136, cuota: 19682.13 },
  { li: 374837.89,   ls: 590795.99,    tasa: 0.2352, cuota: 60049.40 },
  { li: 590796.00,   ls: 1127926.84,   tasa: 0.3000, cuota: 110842.74 },
  { li: 1127926.85,  ls: 1503902.46,   tasa: 0.3200, cuota: 271981.99 },
  { li: 1503902.47,  ls: 4511707.37,   tasa: 0.3400, cuota: 392294.17 },
  { li: 4511707.38,  ls: Infinity,     tasa: 0.3500, cuota: 1414947.85 },
];

// Tabla LFT vacaciones 2023 (Art. 76)
export interface TramoVacaciones { anios: number; dias: number }
export const TABLA_VACACIONES_LFT: TramoVacaciones[] = [
  { anios: 1, dias: 12 },
  { anios: 2, dias: 14 },
  { anios: 3, dias: 16 },
  { anios: 4, dias: 18 },
  { anios: 5, dias: 20 },
  { anios: 10, dias: 22 },
  { anios: 15, dias: 24 },
  { anios: 20, dias: 26 },
  { anios: 25, dias: 28 },
  { anios: 30, dias: 30 },
  { anios: 31, dias: 32 },
];

// ---------- Vacaciones LFT ---------------------------------------------------

export function diasVacacionesLFT(aniosAntiguedad: number): number {
  if (!aniosAntiguedad || aniosAntiguedad < 1) return 12;
  for (let i = TABLA_VACACIONES_LFT.length - 1; i >= 0; i--) {
    if (aniosAntiguedad >= TABLA_VACACIONES_LFT[i].anios) {
      return TABLA_VACACIONES_LFT[i].dias;
    }
  }
  return 12;
}

// ---------- ISR anual --------------------------------------------------------

export function calcularISR(utilidad: number): number {
  if (utilidad <= 0) return 0;
  for (const t of TARIFA_ISR) {
    if (utilidad <= t.ls) {
      return t.cuota + (utilidad - t.li) * t.tasa;
    }
  }
  return 0;
}

// ---------- Cálculo de cobranza por sesión ------------------------------------

export interface ParamMap {
  [clave: string]: string | number | undefined;
}

export interface SesionCobranza {
  sesiones_matutinas?: number;
  sesiones_regulares?: number;
  beca_porcentaje?: number;
  forma_pago_mes?: FormaPago;
  monto_override?: number | null;
}

export interface PagoCobranza {
  forma_pago?: FormaPago;
  dia_pago?: number;
  fecha_pago?: string | Date;
  monto_pagado?: number;
}

export interface ResultadoTerapia {
  subtotal: number;
  becaAplicada: number;
  neto: number;
  recargo: number;
  iva: number;
  totalEsperado: number;
  saldo: number;
  sesiones: number;
}

// Precio por sesión según convención:
//   NULL en paciente            → usa precio global de parámetros
//   0 en paciente               → literal $0 (no cobra, ej. beca completa)
//   >0 en paciente              → ese precio
// Crítico: ?? (nullish) en vez de || (falsy), si no el 0 explícito se pierde.
export function precioPorSesion(
  paciente: Pick<Paciente, "precio_sesion_regular" | "precio_sesion_matutina"> | null | undefined,
  params: ParamMap,
  tipo: "Regular" | "Matutina" = "Regular",
): number {
  const claveGlobal = tipo === "Matutina" ? "precio_terapia_matutina" : "precio_terapia_regular";
  const fallback = tipo === "Matutina" ? 900 : 1100;
  const personal = tipo === "Matutina" ? paciente?.precio_sesion_matutina : paciente?.precio_sesion_regular;
  if (personal === null || personal === undefined) {
    return Number(params[claveGlobal] ?? fallback);
  }
  return Number(personal); // puede ser 0 (literal "no cobra")
}

export function calcularTotalTerapia(
  sesion: SesionCobranza | null | undefined,
  pago: PagoCobranza | null | undefined,
  params: ParamMap,
  paciente: Paciente | null | undefined,
): ResultadoTerapia {
  const precioMat = precioPorSesion(paciente, params, "Matutina");
  const precioReg = precioPorSesion(paciente, params, "Regular");
  const ivaRate = Number(params.iva ?? 0.16);
  const recargoPct = Number(params.recargo_pago_tarde ?? 0.10);
  const diaTope = Number(params.dia_tope_pago ?? 10);

  const matutinas = Number(sesion?.sesiones_matutinas ?? 0);
  const regulares = Number(sesion?.sesiones_regulares ?? 0);
  const becaPct = Number(sesion?.beca_porcentaje ?? 0) / 100;
  const formaPago: FormaPago = pago?.forma_pago || sesion?.forma_pago_mes || "Efectivo";

  const subtotal =
    sesion?.monto_override != null && Number(sesion.monto_override) > 0
      ? Number(sesion.monto_override)
      : matutinas * precioMat + regulares * precioReg;
  const becaAplicada = subtotal * becaPct;
  const neto = subtotal - becaAplicada;

  const diaPago =
    pago?.dia_pago ?? (pago?.fecha_pago ? new Date(pago.fecha_pago).getDate() : null);
  const recargo = diaPago && diaPago > diaTope ? neto * recargoPct : 0;
  const iva = formaPago !== "Efectivo" ? (neto + recargo) * ivaRate : 0;
  const totalEsperado = neto + recargo + iva;
  const montoPagado = Number(pago?.monto_pagado ?? 0);
  const saldo = totalEsperado - montoPagado;

  return {
    subtotal,
    becaAplicada,
    neto,
    recargo,
    iva,
    totalEsperado,
    saldo,
    sesiones: matutinas + regulares,
  };
}

// ---------- Cálculo de eventos (citas y evaluaciones) ------------------------

export interface EventoCobranza {
  tipo: string;
  precio_base?: number | null;
  forma_pago?: FormaPago;
  monto_pagado?: number;
}

export interface ResultadoEvento {
  precioBase: number;
  iva: number;
  totalEsperado: number;
  montoPagado: number;
  saldo: number;
}

export function calcularTotalEvento(evento: EventoCobranza, params: ParamMap): ResultadoEvento {
  const ivaRate = Number(params.iva ?? 0.16);
  const precios: Record<string, number> = {
    "Cita inicial / ingreso":         Number(params.precio_cita_inicial ?? 1000),
    "Cita seguimiento directora":     Number(params.precio_cita_seguimiento ?? 1000),
    "Cita escolar virtual":           Number(params.precio_cita_escolar_virtual ?? 1500),
    "Cita escolar presencial":        Number(params.precio_cita_escolar_presencial ?? 2000),
    "Observación escolar":            Number(params.precio_observacion_escolar ?? 2800),
    "Reporte adicional":              Number(params.precio_reporte_adicional ?? 3000),
    "Evaluación":                     Number(params.precio_evaluacion ?? 8500),
    "Safe and Sound":                 Number(params.precio_safe_and_sound ?? 0),
  };
  const precioBase = Number(evento.precio_base) || precios[evento.tipo] || 0;
  const conIva = evento.forma_pago !== "Efectivo";
  const iva = conIva ? Math.round(precioBase * ivaRate) : 0;
  const totalEsperado = precioBase + iva;
  const montoPagado = Number(evento.monto_pagado ?? 0);
  // monto_pagado = total recibido tal cual (con IVA si la forma de pago lo incluye).
  // El IVA se deriva para el contador en Para el Contador / Impuestos.
  const saldoBruto = totalEsperado - montoPagado;
  const saldo = Math.abs(saldoBruto) <= 50 ? 0 : saldoBruto;
  return { precioBase, iva, totalEsperado, montoPagado, saldo };
}

// ---------- Estatus visual de CxC --------------------------------------------

export interface EstatusCxC {
  label: "AL CORRIENTE" | "PENDIENTE" | "ATRASADO" | "CRÍTICO";
  color: "green" | "yellow" | "orange" | "red";
}

export function estatusCxC(saldo: number, diaHoy?: number): EstatusCxC {
  if (saldo <= 0) return { label: "AL CORRIENTE", color: "green" };
  const dia = diaHoy ?? new Date().getDate();
  if (dia <= 10) return { label: "PENDIENTE", color: "yellow" };
  if (dia <= 20) return { label: "ATRASADO", color: "orange" };
  return { label: "CRÍTICO", color: "red" };
}

// ---------- Paciente aplica en mes --------------------------------------------

export function pacienteAplicaEnMes(
  paciente: Paciente | null | undefined,
  mes: number,
  anio: number,
): boolean {
  if (!paciente) return false;

  // Regla 1: Debe tener mes_inicio y anio_inicio capturados
  if (!paciente.mes_inicio || !paciente.anio_inicio) return false;

  // Regla 1 cont.: (anio_inicio < A) o (anio_inicio = A y mes_inicio <= M)
  const inicioVal = paciente.anio_inicio * 100 + paciente.mes_inicio;
  const mesAnoVal = anio * 100 + mes;
  if (inicioVal > mesAnoVal) return false;

  // Regla 2: Si tiene fecha de alta capturada, el alta es el último mes válido
  if (paciente.mes_alta && paciente.anio_alta) {
    const altaVal = paciente.anio_alta * 100 + paciente.mes_alta;
    if (altaVal < mesAnoVal) return false; // Mes consultado es posterior al alta
  } else if (paciente.estatus === "Inactivo") {
    // Inactivo sin fecha de alta capturada: no aplica en ningún mes
    return false;
  }

  return true;
}

// ---------- Date helpers -----------------------------------------------------

// JavaScript parsea las strings "YYYY-MM-DD" como UTC midnight. En zonas
// horarias negativas (México UTC-6) eso se convierte a la fecha anterior en
// local time — un gasto del 1 de mayo termina contándose en abril.
// Esta función parsea la fecha como LOCAL time para evitar ese corrimiento.
export function parseFechaLocal(fecha: string | null | undefined): Date | null {
  if (!fecha || typeof fecha !== "string") return null;
  const m = fecha.substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// ---------- Format helpers ---------------------------------------------------

export function fmtMXN(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

// ---------- Parametros helpers ------------------------------------------------

interface ParametroLite { clave: string; valor: string }

export function getParamValue(
  params: ParametroLite[] | null | undefined,
  clave: string,
  defaultVal: number,
): number {
  const p = params?.find((p) => p.clave === clave);
  return p ? Number(p.valor) : defaultVal;
}

export function paramsToObject(paramsList: ParametroLite[] | null | undefined): ParamMap {
  const obj: ParamMap = {};
  (paramsList || []).forEach((p) => {
    obj[p.clave] = p.valor;
  });
  return obj;
}

// Año actual: D6 — leer de Parametro.clave='anio_actual'; fallback al año del sistema.
export function getAnioActual(params: ParametroLite[] | null | undefined): number {
  const fallback = new Date().getFullYear();
  const v = params?.find((p) => p.clave === "anio_actual")?.valor;
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 2000 ? n : fallback;
}

// ---------- Generar grilla de calendario mensual -----------------------------

export type TipoCelda = "vacio" | "sesion" | "excepcion" | "libre";

export interface CeldaCalendario {
  dia: number | null;
  tipo: TipoCelda;
  hora?: string;
  diaSemana?: number;
}

export interface CalendarioMes {
  celdas: CeldaCalendario[][];
  totalSesiones: number;
}

export function generarCalendario(
  anio: number,
  mes: number,
  horarioSemanal: HorarioSemanal,
  excepcionesStr?: string,
): CalendarioMes {
  const excepciones = (excepcionesStr || "")
    .split(",")
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => !isNaN(d));
  const diasEnMes = new Date(anio, mes, 0).getDate();
  const primerDia = new Date(anio, mes - 1, 1).getDay(); // 0 = domingo
  // Convertir a lunes-primero
  const offset = (primerDia + 6) % 7;

  const celdas: CeldaCalendario[][] = []; // 6 filas x 7 cols
  let diaActual = 1;
  for (let fila = 0; fila < 6; fila++) {
    const semana: CeldaCalendario[] = [];
    for (let col = 0; col < 7; col++) {
      const idx = fila * 7 + col;
      if (idx < offset || diaActual > diasEnMes) {
        semana.push({ dia: null, tipo: "vacio" });
      } else {
        const dia = diaActual;
        const weekday = col; // 0 = lunes
        const keys: Array<keyof HorarioSemanal> = [
          "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
        ];
        const hora = horarioSemanal[keys[weekday]];
        if (excepciones.includes(dia)) {
          semana.push({ dia, tipo: "excepcion", diaSemana: weekday });
        } else if (hora) {
          semana.push({ dia, tipo: "sesion", hora, diaSemana: weekday });
        } else {
          semana.push({ dia, tipo: "libre", diaSemana: weekday });
        }
        diaActual++;
      }
    }
    celdas.push(semana);
  }

  const totalSesiones = celdas.flat().filter((c) => c.tipo === "sesion").length;
  return { celdas, totalSesiones };
}

// =============================================================================
// Cálculo de nómina México 2026 — Flujo Consentido
// VERIFICAR valores contra DOF / IMSS / INEGI antes de producción.
// =============================================================================

interface TramoISRNomina { liInf: number; liSup: number; cuotaFija: number; tasa: number }

const TARIFA_ISR_MENSUAL_NOMINA: TramoISRNomina[] = [
  { liInf: 0.01,        liSup: 746.04,     cuotaFija: 0.00,      tasa: 0.0192 },
  { liInf: 746.05,      liSup: 6332.05,    cuotaFija: 14.32,     tasa: 0.0640 },
  { liInf: 6332.06,     liSup: 11128.01,   cuotaFija: 371.83,    tasa: 0.1088 },
  { liInf: 11128.02,    liSup: 12935.82,   cuotaFija: 893.63,    tasa: 0.1600 },
  { liInf: 12935.83,    liSup: 15487.71,   cuotaFija: 1182.88,   tasa: 0.1792 },
  { liInf: 15487.72,    liSup: 31236.49,   cuotaFija: 1640.18,   tasa: 0.2136 },
  { liInf: 31236.50,    liSup: 49233.00,   cuotaFija: 5004.12,   tasa: 0.2352 },
  { liInf: 49233.01,    liSup: 93993.90,   cuotaFija: 9236.89,   tasa: 0.3000 },
  { liInf: 93993.91,    liSup: 125325.20,  cuotaFija: 22665.17,  tasa: 0.3200 },
  { liInf: 125325.21,   liSup: 375975.61,  cuotaFija: 32691.18,  tasa: 0.3400 },
  { liInf: 375975.62,   liSup: Infinity,   cuotaFija: 117912.32, tasa: 0.3500 },
];

const SUBSIDIO_EMPLEO_TOPE_NOM = 8952.35;
const SUBSIDIO_EMPLEO_MONTO_NOM = 475.00;
const UMA_DIARIA_NOM = 118.50;
const DIAS_MES_NOM = 30.4;

const IMSS_PATRONAL_TASAS = {
  enfMatEnEspecieFija: 0.2040,
  enfMatAdicionalEnEspecie: 0.0110,
  prestacionesDinero: 0.0070,
  gastosMedPensionados: 0.0105,
  invalidezVida: 0.0175,
  riesgoTrabajo: 0.0054355,
  cesantiaVejez: 0.04786,
  guarderias: 0.0100,
  retiroAfore: 0.0200,
};

const IMSS_OBRERA_TASAS = {
  enfMatAdicionalEnEspecie: 0.0040,
  prestacionesDinero: 0.0025,
  gastosMedPensionados: 0.00375,
  invalidezVida: 0.00625,
  cesantiaVejez: 0.01125,
};

function _isrMensNom(bruto: number): number {
  const f = TARIFA_ISR_MENSUAL_NOMINA.find((x) => bruto >= x.liInf && bruto <= x.liSup);
  return f ? f.cuotaFija + (bruto - f.liInf) * f.tasa : 0;
}

function _isrRetNom(bruto: number): number {
  return Math.max(
    0,
    _isrMensNom(bruto) - (bruto <= SUBSIDIO_EMPLEO_TOPE_NOM ? SUBSIDIO_EMPLEO_MONTO_NOM : 0),
  );
}

function _imssObr(sbc: number, uma: number): number {
  const t3 = 3 * uma * DIAS_MES_NOM;
  const exc = Math.max(0, sbc - t3);
  return (
    exc * IMSS_OBRERA_TASAS.enfMatAdicionalEnEspecie +
    sbc * IMSS_OBRERA_TASAS.prestacionesDinero +
    sbc * IMSS_OBRERA_TASAS.gastosMedPensionados +
    sbc * IMSS_OBRERA_TASAS.invalidezVida +
    sbc * IMSS_OBRERA_TASAS.cesantiaVejez
  );
}

function _immsPat(sbc: number, uma: number): number {
  const t3 = 3 * uma * DIAS_MES_NOM;
  const exc = Math.max(0, sbc - t3);
  const um = uma * DIAS_MES_NOM;
  return (
    um * IMSS_PATRONAL_TASAS.enfMatEnEspecieFija +
    exc * IMSS_PATRONAL_TASAS.enfMatAdicionalEnEspecie +
    sbc *
      (IMSS_PATRONAL_TASAS.prestacionesDinero +
        IMSS_PATRONAL_TASAS.gastosMedPensionados +
        IMSS_PATRONAL_TASAS.invalidezVida +
        IMSS_PATRONAL_TASAS.riesgoTrabajo +
        IMSS_PATRONAL_TASAS.cesantiaVejez +
        IMSS_PATRONAL_TASAS.guarderias +
        IMSS_PATRONAL_TASAS.retiroAfore)
  );
}

export interface OpcionesNomina {
  formaPago?: FormaPago;
  factorIntegracion?: number;
  uma?: number;
}

export interface ResultadoNomina {
  neto: number;
  bruto: number;
  sbcDiario: number;
  sbcMensual: number;
  isrRetenido: number;
  imssObrera: number;
  imssPatronal: number;
  infonavitPatronal: number;
  costoTotalEmpresa: number;
  declarado: boolean;
  iteraciones: number;
}

// Gross-up iterativo: dado un neto deseado, encuentra el bruto que lo
// produce después de ISR e IMSS obrera. Si forma_pago es Efectivo, se
// reporta como no-declarado (neto == bruto, sin retenciones).
export function calcularNominaDesdeNeto(
  neto: number,
  opciones: OpcionesNomina = {},
): ResultadoNomina {
  const fp: FormaPago = opciones.formaPago ?? "Transferencia";
  if (fp === "Efectivo") {
    return {
      neto,
      bruto: neto,
      sbcDiario: 0,
      sbcMensual: 0,
      isrRetenido: 0,
      imssObrera: 0,
      imssPatronal: 0,
      infonavitPatronal: 0,
      costoTotalEmpresa: neto,
      declarado: false,
      iteraciones: 0,
    };
  }
  const fi = opciones.factorIntegracion ?? 1.0452;
  const uma = opciones.uma ?? UMA_DIARIA_NOM;
  let bruto = neto / 0.85;
  let iter = 0;
  let netoCalc = 0;
  let delta = 0;
  do {
    const sd = Math.min((bruto / DIAS_MES_NOM) * fi, 25 * uma);
    const sm = sd * DIAS_MES_NOM;
    netoCalc = bruto - _isrRetNom(bruto) - _imssObr(sm, uma);
    delta = neto - netoCalc;
    bruto = bruto + delta * 0.95;
    iter++;
  } while (Math.abs(delta) > 0.50 && iter < 50);

  const sD = Math.min((bruto / DIAS_MES_NOM) * fi, 25 * uma);
  const sM = sD * DIAS_MES_NOM;
  const isr = _isrRetNom(bruto);
  const obr = _imssObr(sM, uma);
  const pat = _immsPat(sM, uma);
  const inf = sM * 0.05;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    neto: r(neto),
    bruto: r(bruto),
    sbcDiario: r(sD),
    sbcMensual: r(sM),
    isrRetenido: r(isr),
    imssObrera: r(obr),
    imssPatronal: r(pat),
    infonavitPatronal: r(inf),
    costoTotalEmpresa: r(bruto + pat + inf),
    declarado: true,
    iteraciones: iter,
  };
}
