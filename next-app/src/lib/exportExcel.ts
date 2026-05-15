// =============================================================================
// exportExcel.ts — Genera un .xlsx de respaldo organizado para humanos.
//
// Orden de pestañas:
//   EDITABLES (al frente):
//     1. Pacientes
//     2. Empleados
//     3. Terapias
//     4. Citas
//     5. Evaluaciones
//     6. Subarrendamiento
//     7. Gastos
//     8. Nómina
//   RESÚMENES (calculados):
//     9. Flujo de Efectivo
//    10. Para el Contador
//   CONFIG (raro tocar):
//    11. Parámetros
//    12. Tablas
//    13. Cómo usar este Excel
//
// Convenciones visuales:
//   - Header MORADO con texto blanco = columna EDITABLE
//   - Header GRIS con texto blanco   = columna CALCULADA (fórmula viva)
//   - Fila de TOTAL en amarillo claro
//   - Fila resumen INGRESOS en verde, EGRESOS en rojo, SALDO en violeta
// =============================================================================

import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import {
  TARIFA_ISR, TABLA_VACACIONES_LFT,
  type ParamMap,
} from "@/lib/calculos";
import type {
  Paciente, Empleado, SesionMensual, PagoTerapia, Evento,
  Subarrendamiento, Gasto, NominaMensual, Parametro, FormaPago,
} from "@/types/db";

const COLOR_HEADER_EDIT = "FF7C3AED";    // morado (editable)
const COLOR_HEADER_CALC = "FF6B7280";    // gris (calculado)
const COLOR_TOTAL       = "FFFEF3C7";    // amarillo claro
const COLOR_INGRESO     = "FFD1FAE5";    // verde claro
const COLOR_EGRESO      = "FFFEE2E2";    // rojo claro
const COLOR_SALDO       = "FFEDE9FE";    // violeta claro

const FORMAS_PAGO: FormaPago[] = ["Efectivo", "Transferencia", "Tarjeta", "Depósito"];

// ---------- Helpers ----------

function paramsToMap(params: Parametro[]): ParamMap {
  const m: ParamMap = {};
  for (const p of params) m[p.clave] = p.valor;
  return m;
}

function applyHeader(ws: ExcelJS.Worksheet, row: number, cols: { calc?: boolean }[]) {
  cols.forEach((c, i) => {
    const cell = ws.getRow(row).getCell(i + 1);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.calc ? COLOR_HEADER_CALC : COLOR_HEADER_EDIT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
  ws.getRow(row).height = 32;
}

function setWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function moneyFmt(cell: ExcelJS.Cell) { cell.numFmt = '"$"#,##0.00'; }

function totalRow(ws: ExcelJS.Worksheet, values: (string | number | { formula: string })[], moneyCols: number[]) {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };
  moneyCols.forEach((c) => moneyFmt(row.getCell(c)));
  return row;
}

function addListValidation(ws: ExcelJS.Worksheet, colLetter: string, fromRow: number, toRow: number, options: string[]) {
  const range = `${colLetter}${fromRow}:${colLetter}${toRow}`;
  // exceljs expone dataValidations en runtime pero no en sus tipos
  (ws as unknown as { dataValidations: { add: (range: string, def: object) => void } }).dataValidations.add(range, {
    type: "list",
    allowBlank: true,
    formulae: [`"${options.join(",")}"`],
    showErrorMessage: true,
    errorStyle: "warning",
    errorTitle: "Valor no permitido",
    error: `Selecciona uno de: ${options.join(", ")}`,
  });
}

function legend(ws: ExcelJS.Worksheet, row: number) {
  const r = ws.getRow(row);
  r.getCell(1).value = "🟣 Editable    ⬜ Calculado (fórmula viva)    🟡 Total";
  r.getCell(1).font = { italic: true, color: { argb: "FF6B7280" }, size: 10 };
  ws.mergeCells(row, 1, row, 8);
}

// ============================================================================
// Helpers de datos
// ============================================================================

function dedupPacientes(pacientes: Paciente[]): Paciente[] {
  // Dedup por nombre (case + trim). Si hay duplicados, conserva el que tiene
  // más datos completos (mes_inicio + precio definido).
  const score = (p: Paciente) =>
    (p.mes_inicio ? 1 : 0) + (p.anio_inicio ? 1 : 0) +
    (p.precio_sesion_regular != null ? 1 : 0) + (p.estatus === "Activo" ? 1 : 0);
  const map = new Map<string, Paciente>();
  for (const p of pacientes) {
    const key = (p.nombre || "").toLowerCase().trim();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || score(p) > score(existing)) map.set(key, p);
  }
  return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function dedupSesiones(sesiones: SesionMensual[]): SesionMensual[] {
  // Dedup por (paciente_id, anio, mes). Conserva la más reciente (created_date).
  const map = new Map<string, SesionMensual>();
  for (const s of sesiones) {
    const key = `${s.paciente_id}|${s.anio}|${s.mes}`;
    const existing = map.get(key);
    if (!existing || (s.created_date ?? "") > (existing.created_date ?? "")) {
      map.set(key, s);
    }
  }
  return Array.from(map.values());
}

// ============================================================================
// 1. PESTAÑA: Pacientes
// ============================================================================

function pestPacientes(wb: ExcelJS.Workbook, pacientes: Paciente[]) {
  const ws = wb.addWorksheet("Pacientes", { properties: { tabColor: { argb: "FF22C55E" } } });

  ws.addRow([
    "Nombre", "Estatus", "Precio Sesión", "Inicio Terapia", "Año Inicio",
    "Alta (Mes)", "Año Alta", "Notas",
  ]);
  applyHeader(ws, 1, [{}, {}, {}, {}, {}, {}, {}, {}]);

  pacientes.forEach((p) => {
    const row = ws.addRow([
      p.nombre,
      p.estatus,
      p.precio_sesion_regular ?? null,
      p.mes_inicio,
      p.anio_inicio,
      p.mes_alta,
      p.anio_alta,
      p.notas ?? "",
    ]);
    moneyFmt(row.getCell(3));
    row.getCell(3).note = "Vacío = usa precio global de Parámetros. 0 = no cobra (beca completa).";
  });

  // Dropdowns
  const lastRow = pacientes.length + 1;
  addListValidation(ws, "B", 2, lastRow, ["Activo", "Inactivo", "Pausado"]);

  setWidths(ws, [32, 10, 14, 11, 10, 11, 10, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// 2. PESTAÑA: Empleados
// ============================================================================

function pestEmpleados(wb: ExcelJS.Workbook, empleados: Empleado[]) {
  const ws = wb.addWorksheet("Empleados", { properties: { tabColor: { argb: "FF22C55E" } } });
  ws.addRow([
    "Nombre", "Puesto", "Sueldo Transferencia (Neto)", "Sueldo Efectivo",
    "Total Sueldo", "Fecha Ingreso", "Estatus", "Notas",
  ]);
  applyHeader(ws, 1, [{}, {}, {}, {}, { calc: true }, {}, {}, {}]);

  const activos = empleados.filter((e) => e.estatus === "Activo").sort((a, b) => a.nombre.localeCompare(b.nombre));
  const inactivos = empleados.filter((e) => e.estatus !== "Activo").sort((a, b) => a.nombre.localeCompare(b.nombre));
  const todos = [...activos, ...inactivos];

  todos.forEach((e, i) => {
    const r = i + 2;
    const row = ws.addRow([
      e.nombre,
      e.puesto ?? "",
      Number(e.sueldo_transferencia_mes ?? 0),
      Number(e.sueldo_efectivo_mes ?? 0),
      { formula: `C${r}+D${r}` },
      e.fecha_ingreso ? new Date(e.fecha_ingreso) : null,
      e.estatus,
      e.notas ?? "",
    ]);
    moneyFmt(row.getCell(3));
    moneyFmt(row.getCell(4));
    moneyFmt(row.getCell(5));
    row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    if (e.fecha_ingreso) row.getCell(6).numFmt = "yyyy-mm-dd";
  });

  // Dropdown Estatus
  addListValidation(ws, "G", 2, todos.length + 1, ["Activo", "Inactivo"]);

  setWidths(ws, [32, 18, 18, 16, 14, 14, 10, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// 3. PESTAÑA: Terapias (cobranza por paciente × mes)
// ============================================================================

function pestTerapias(
  wb: ExcelJS.Workbook,
  anio: number,
  pacientes: Paciente[],
  sesiones: SesionMensual[],
  pagos: PagoTerapia[],
) {
  const ws = wb.addWorksheet("Terapias", { properties: { tabColor: { argb: "FFF59E0B" } } });
  ws.addRow([
    "Paciente", "Mes", "Sesiones Mat.", "Sesiones Reg.", "Beca %", "Forma de Pago",
    "Precio Reg.", "Precio Mat.", "Subtotal", "IVA", "Total Esperado", "Pagado", "Saldo",
  ]);
  applyHeader(ws, 1, [
    {}, {}, {}, {}, {}, {},
    { calc: true }, { calc: true }, { calc: true }, { calc: true }, { calc: true }, {}, { calc: true },
  ]);

  // Construir filas: una por (paciente, mes) — sin duplicados
  const sesionesDedup = dedupSesiones(sesiones.filter((s) => s.anio === anio));
  const pacMap = new Map(pacientes.map((p) => [p.id, p]));
  const filas: Array<{ pac: Paciente; mes: number; s: SesionMensual; pagado: number }> = [];
  for (const s of sesionesDedup) {
    const pac = pacMap.get(s.paciente_id);
    if (!pac) continue;
    const pagado = pagos
      .filter((p) => p.paciente_id === s.paciente_id && p.anio === anio && p.mes === s.mes)
      .reduce((sum, p) => sum + Number(p.monto_pagado ?? 0), 0);
    filas.push({ pac, mes: s.mes, s, pagado });
  }
  filas.sort((a, b) => a.pac.nombre.localeCompare(b.pac.nombre) || a.mes - b.mes);

  const totalPacientes = pacientes.length + 1;
  filas.forEach((f, i) => {
    const r = i + 2;
    // Precio Reg: VLOOKUP a Pacientes (col C). Si NULL/vacío → PRECIO_REG global.
    // Pacientes está dedup-eado pero aquí busco por nombre directo
    const precioRegFx = `IFERROR(IF(ISNUMBER(VLOOKUP(A${r},Pacientes!$A$2:$C$${totalPacientes},3,FALSE)),VLOOKUP(A${r},Pacientes!$A$2:$C$${totalPacientes},3,FALSE),PRECIO_REG),PRECIO_REG)`;
    const precioMatFx = `IF(G${r}>0,G${r},PRECIO_MAT)`; // sin matutina específica por ahora — usa la global como fallback con override de Reg si aplica
    const subtotalFx = `C${r}*H${r}+D${r}*G${r}`;
    const becaPctRef = `E${r}/100`;
    const netoFx = `I${r}*(1-${becaPctRef})`;
    const ivaFx = `IF(F${r}="Efectivo",0,(${netoFx})*IVA)`;
    const totalFx = `(${netoFx})+J${r}`;
    const saldoFx = `K${r}-L${r}`;

    const row = ws.addRow([
      f.pac.nombre,
      f.mes,
      Number(f.s.sesiones_matutinas ?? 0),
      Number(f.s.sesiones_regulares ?? 0),
      Number(f.s.beca_porcentaje ?? 0),
      f.s.forma_pago_mes,
      { formula: precioRegFx },
      { formula: precioMatFx },
      { formula: subtotalFx },
      { formula: ivaFx },
      { formula: totalFx },
      f.pagado,
      { formula: saldoFx },
    ]);
    [7, 8, 9, 10, 11, 12, 13].forEach((c) => moneyFmt(row.getCell(c)));
    // Fondo gris claro en columnas calculadas
    [7, 8, 9, 10, 11, 13].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  });

  // Dropdown forma de pago
  if (filas.length > 0) {
    addListValidation(ws, "F", 2, filas.length + 1, FORMAS_PAGO);
  }

  // Total
  if (filas.length > 0) {
    const last = filas.length + 1;
    totalRow(ws, [
      "TOTAL", "", "", "", "", "",
      "", "",
      { formula: `SUM(I2:I${last})` },
      { formula: `SUM(J2:J${last})` },
      { formula: `SUM(K2:K${last})` },
      { formula: `SUM(L2:L${last})` },
      { formula: `SUM(M2:M${last})` },
    ], [9, 10, 11, 12, 13]);
  }

  setWidths(ws, [32, 6, 12, 12, 8, 14, 11, 11, 12, 10, 13, 11, 11]);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
}

// ============================================================================
// 4-5. PESTAÑAS: Citas y Evaluaciones
// ============================================================================

function pestEventos(
  wb: ExcelJS.Workbook,
  anio: number,
  eventos: Evento[],
  tipoFiltro: "citas" | "evaluaciones",
) {
  const TIPOS_CITAS = [
    "Cita inicial / ingreso", "Cita seguimiento directora",
    "Cita escolar virtual", "Cita escolar presencial",
    "Observación escolar", "Reporte adicional",
  ];
  const TIPOS_EVAL = ["Evaluación"];
  const tipos = tipoFiltro === "citas" ? TIPOS_CITAS : TIPOS_EVAL;
  const sheetName = tipoFiltro === "citas" ? "Citas" : "Evaluaciones";

  const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: "FFEC4899" } } });
  ws.addRow([
    "Fecha", "Tipo", "Paciente / Solicitante", "Forma de Pago",
    "Subtotal (sin IVA)", "IVA", "Total", "Pagado", "Saldo", "Notas",
  ]);
  applyHeader(ws, 1, [
    {}, {}, {}, {},
    {}, { calc: true }, { calc: true }, {}, { calc: true }, {},
  ]);

  const evs = eventos
    .filter((ev) => ev.fecha?.startsWith(String(anio)) && tipos.includes(ev.tipo))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  evs.forEach((ev, i) => {
    const r = i + 2;
    const ivaFx = `IF(D${r}="Efectivo",0,E${r}*IVA)`;
    const totalFx = `E${r}+F${r}`;
    const saldoFx = `G${r}-H${r}`;

    const row = ws.addRow([
      ev.fecha ? new Date(ev.fecha + "T12:00:00") : null,
      ev.tipo,
      ev.nombre_paciente,
      ev.forma_pago,
      Number(ev.precio_base ?? 0),
      { formula: ivaFx },
      { formula: totalFx },
      Number(ev.monto_pagado ?? 0),
      { formula: saldoFx },
      ev.notas ?? "",
    ]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    [5, 6, 7, 8, 9].forEach((c) => moneyFmt(row.getCell(c)));
    [6, 7, 9].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  });

  if (evs.length > 0) {
    addListValidation(ws, "B", 2, evs.length + 1, tipos);
    addListValidation(ws, "D", 2, evs.length + 1, FORMAS_PAGO);
    const last = evs.length + 1;
    totalRow(ws, [
      "TOTAL", "", "", "",
      { formula: `SUM(E2:E${last})` },
      { formula: `SUM(F2:F${last})` },
      { formula: `SUM(G2:G${last})` },
      { formula: `SUM(H2:H${last})` },
      { formula: `SUM(I2:I${last})` },
      "",
    ], [5, 6, 7, 8, 9]);
  }

  setWidths(ws, [12, 28, 30, 14, 14, 10, 12, 11, 11, 28]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// 6. PESTAÑA: Subarrendamiento
// ============================================================================

function pestSubarrendamiento(wb: ExcelJS.Workbook, anio: number, subarr: Subarrendamiento[]) {
  const ws = wb.addWorksheet("Subarrendamiento", { properties: { tabColor: { argb: "FF06B6D4" } } });
  ws.addRow([
    "Inquilino", "Mes", "Forma de Pago", "Monto Cobrado",
    "Subtotal sin IVA", "IVA", "Notas",
  ]);
  applyHeader(ws, 1, [{}, {}, {}, {}, { calc: true }, { calc: true }, {}]);

  const recs = subarr
    .filter((s) => s.anio === anio)
    .sort((a, b) => a.inquilino.localeCompare(b.inquilino) || a.mes - b.mes);

  recs.forEach((s, i) => {
    const r = i + 2;
    const subFx = `IF(C${r}="Efectivo",D${r},D${r}/(1+IVA))`;
    const ivaFx = `IF(C${r}="Efectivo",0,D${r}-E${r})`;
    const row = ws.addRow([
      s.inquilino,
      s.mes,
      s.forma_pago,
      Number(s.monto_cobrado ?? 0),
      { formula: subFx },
      { formula: ivaFx },
      s.notas ?? "",
    ]);
    [4, 5, 6].forEach((c) => moneyFmt(row.getCell(c)));
    [5, 6].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  });

  if (recs.length > 0) {
    addListValidation(ws, "C", 2, recs.length + 1, FORMAS_PAGO);
    const last = recs.length + 1;
    totalRow(ws, [
      "TOTAL", "", "",
      { formula: `SUM(D2:D${last})` },
      { formula: `SUM(E2:E${last})` },
      { formula: `SUM(F2:F${last})` },
      "",
    ], [4, 5, 6]);
  }

  setWidths(ws, [22, 6, 14, 14, 14, 12, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// 7. PESTAÑA: Gastos
// ============================================================================

function pestGastos(wb: ExcelJS.Workbook, anio: number, gastos: Gasto[]) {
  const ws = wb.addWorksheet("Gastos", { properties: { tabColor: { argb: "FFEF4444" } } });
  ws.addRow([
    "Fecha", "Mes", "Categoría", "Concepto", "Proveedor",
    "Forma de Pago", "Con Factura", "Monto", "IVA Acreditable", "Notas",
  ]);
  applyHeader(ws, 1, [{}, { calc: true }, {}, {}, {}, {}, {}, {}, { calc: true }, {}]);

  const recs = gastos
    .filter((g) => g.fecha?.startsWith(String(anio)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  recs.forEach((g, i) => {
    const r = i + 2;
    const mesFx = `MONTH(A${r})`;
    const ivaFx = `IF(G${r}="Sí",H${r}*IVA/(1+IVA),0)`;
    const row = ws.addRow([
      new Date(g.fecha + "T12:00:00"),
      { formula: mesFx },
      g.categoria,
      g.concepto,
      g.proveedor ?? "",
      g.forma_pago,
      g.con_factura ? "Sí" : "No",
      Number(g.monto ?? 0),
      { formula: ivaFx },
      g.notas ?? "",
    ]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    moneyFmt(row.getCell(8));
    moneyFmt(row.getCell(9));
    [2, 9].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  });

  if (recs.length > 0) {
    addListValidation(ws, "C", 2, recs.length + 1, [
      "Renta", "Materiales Centro", "Materiales Limpieza", "Comidas", "Servicios",
      "Renta Terapeutas", "Capacitaciones", "Nómina", "Impuestos", "Otros",
    ]);
    addListValidation(ws, "F", 2, recs.length + 1, FORMAS_PAGO);
    addListValidation(ws, "G", 2, recs.length + 1, ["Sí", "No"]);
    const last = recs.length + 1;
    totalRow(ws, [
      "TOTAL", "", "", "", "", "", "",
      { formula: `SUM(H2:H${last})` },
      { formula: `SUM(I2:I${last})` },
      "",
    ], [8, 9]);
  }

  setWidths(ws, [12, 6, 20, 32, 22, 14, 12, 12, 14, 28]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// 8. PESTAÑA: Nómina
// ============================================================================

function pestNomina(wb: ExcelJS.Workbook, anio: number, empleados: Empleado[], nomina: NominaMensual[]) {
  const ws = wb.addWorksheet("Nómina", { properties: { tabColor: { argb: "FFA855F7" } } });
  ws.addRow([
    "Empleado", "Mes",
    "Sueldo Transf.", "Sueldo Efectivo", "Total Sueldo",
    "Aguinaldo (Dic)", "Prima Vac. (mensual)", "Bono",
    "IMSS Patronal", "ISN", "ISR Retenido", "Infonavit",
    "Total Costo Empresa",
  ]);
  applyHeader(ws, 1, [
    {}, {},
    {}, {}, { calc: true },
    { calc: true }, { calc: true }, {},
    { calc: true }, { calc: true }, { calc: true }, { calc: true },
    { calc: true },
  ]);

  const empMap = new Map(empleados.map((e) => [e.id, e]));
  const recs = nomina
    .filter((n) => n.anio === anio)
    .sort((a, b) => {
      const ea = empMap.get(a.empleado_id)?.nombre ?? a.empleado_nombre ?? "";
      const eb = empMap.get(b.empleado_id)?.nombre ?? b.empleado_nombre ?? "";
      return ea.localeCompare(eb) || a.mes - b.mes;
    });

  recs.forEach((n, i) => {
    const r = i + 2;
    const emp = empMap.get(n.empleado_id);
    const fechaIngreso = emp?.fecha_ingreso ? new Date(emp.fecha_ingreso) : null;
    const antiguedad = fechaIngreso ? anio - fechaIngreso.getFullYear() : 0;

    const totalSueldoFx = `C${r}+D${r}`;
    const aguinaldoFx = `IF(B${r}=12,E${r}/30*DIAS_AGUINALDO,0)`;
    const primaFx = antiguedad >= 1
      ? `(E${r}/30*VLOOKUP(${antiguedad},TABLA_VAC,2,TRUE)*0.25)/12`
      : `0`;
    const sbcDiarioFx = `MIN((C${r}*FACTOR_INT)/30.4,25*UMA)`;
    const sbcMensualFx = `(${sbcDiarioFx})*30.4`;
    const imssFx = `(${sbcMensualFx})*IMSS_TASA`;
    const isnFx = `(${sbcMensualFx})*ISN_TASA`;
    const isrFx = `MAX(0,VLOOKUP(C${r},TABLA_ISR,3,TRUE)+(C${r}-VLOOKUP(C${r},TABLA_ISR,1,TRUE))*VLOOKUP(C${r},TABLA_ISR,4,TRUE))`;
    const infFx = `(${sbcMensualFx})*0.05`;
    // Total Costo Empresa = lo que efectivamente sale de la chequera por mes
    // = sueldo total + aguinaldo (Dic) + prima vac + bono + IMSS patronal + ISN + Infonavit
    // (ISR retenido NO es costo de la empresa — es retención al empleado)
    const totalCostoFx = `E${r}+F${r}+G${r}+H${r}+I${r}+J${r}+L${r}`;

    const row = ws.addRow([
      emp?.nombre ?? n.empleado_nombre ?? "",
      n.mes,
      Number(n.sueldo_transferencia ?? 0),
      Number(n.sueldo_efectivo ?? 0),
      { formula: totalSueldoFx },
      { formula: aguinaldoFx },
      { formula: primaFx },
      Number(n.bono ?? 0),
      { formula: imssFx },
      { formula: isnFx },
      { formula: isrFx },
      { formula: infFx },
      { formula: totalCostoFx },
    ]);
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].forEach((c) => moneyFmt(row.getCell(c)));
    [5, 6, 7, 9, 10, 11, 12, 13].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  });

  if (recs.length > 0) {
    const last = recs.length + 1;
    totalRow(ws, [
      "TOTAL", "",
      { formula: `SUM(C2:C${last})` },
      { formula: `SUM(D2:D${last})` },
      { formula: `SUM(E2:E${last})` },
      { formula: `SUM(F2:F${last})` },
      { formula: `SUM(G2:G${last})` },
      { formula: `SUM(H2:H${last})` },
      { formula: `SUM(I2:I${last})` },
      { formula: `SUM(J2:J${last})` },
      { formula: `SUM(K2:K${last})` },
      { formula: `SUM(L2:L${last})` },
      { formula: `SUM(M2:M${last})` },
    ], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  }

  setWidths(ws, [28, 6, 14, 14, 14, 12, 14, 10, 14, 12, 14, 12, 14]);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
}

// ============================================================================
// 9. PESTAÑA: Flujo de Efectivo
// ============================================================================

function pestFlujoEfectivo(wb: ExcelJS.Workbook, anio: number) {
  const ws = wb.addWorksheet("Flujo de Efectivo", { properties: { tabColor: { argb: "FF0EA5E9" } } });
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  ws.addRow(["Concepto", ...MESES, "Total Año"]);
  applyHeader(ws, 1, [{}, ...new Array(13).fill({ calc: true })]);

  type Fila = { label: string; formula?: (m: number) => string; subtotal?: "ingresos" | "egresos"; neto?: boolean; saldo?: boolean };
  const filas: Fila[] = [
    { label: "(+) Terapias Cobradas",       formula: (m) => `SUMIFS(Terapias!$L:$L,Terapias!$B:$B,${m})` },
    { label: "(+) Citas Cobradas",          formula: (m) => `SUMIFS(Citas!$H:$H,Citas!$A:$A,">="&DATE(${anio},${m},1),Citas!$A:$A,"<"&DATE(${anio},${m + 1},1))` },
    { label: "(+) Evaluaciones Cobradas",   formula: (m) => `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$A:$A,">="&DATE(${anio},${m},1),Evaluaciones!$A:$A,"<"&DATE(${anio},${m + 1},1))` },
    { label: "(+) Subarrendamiento Cobrado", formula: (m) => `SUMIFS(Subarrendamiento!$D:$D,Subarrendamiento!$B:$B,${m})` },
    { label: "= TOTAL INGRESOS",            subtotal: "ingresos" },
    { label: "(-) Gastos",                  formula: (m) => `SUMIFS(Gastos!$H:$H,Gastos!$B:$B,${m})` },
    { label: "(-) Sueldos (Transf + Efvo)", formula: (m) => `SUMIFS(Nómina!$E:$E,Nómina!$B:$B,${m})` },
    { label: "(-) Aguinaldo",               formula: (m) => `SUMIFS(Nómina!$F:$F,Nómina!$B:$B,${m})` },
    { label: "(-) Prima Vacacional",        formula: (m) => `SUMIFS(Nómina!$G:$G,Nómina!$B:$B,${m})` },
    { label: "(-) Bono",                    formula: (m) => `SUMIFS(Nómina!$H:$H,Nómina!$B:$B,${m})` },
    { label: "(-) IMSS Patronal",           formula: (m) => `SUMIFS(Nómina!$I:$I,Nómina!$B:$B,${m})` },
    { label: "(-) ISN",                     formula: (m) => `SUMIFS(Nómina!$J:$J,Nómina!$B:$B,${m})` },
    { label: "(-) Infonavit",               formula: (m) => `SUMIFS(Nómina!$L:$L,Nómina!$B:$B,${m})` },
    { label: "= TOTAL EGRESOS",             subtotal: "egresos" },
    { label: "FLUJO NETO DEL MES",          neto: true },
    { label: "SALDO ACUMULADO",             saldo: true },
  ];

  const rowOfIngresosTotal = filas.findIndex((f) => f.subtotal === "ingresos") + 2;
  const rowOfEgresosTotal = filas.findIndex((f) => f.subtotal === "egresos") + 2;
  const rowOfNeto = filas.findIndex((f) => f.neto) + 2;
  const rowOfSaldo = filas.findIndex((f) => f.saldo) + 2;
  const ingresosStart = 2;
  const ingresosEnd = rowOfIngresosTotal - 1;
  const egresosStart = rowOfIngresosTotal + 1;
  const egresosEnd = rowOfEgresosTotal - 1;

  filas.forEach((f, i) => {
    const r = i + 2;
    const values: (string | number | { formula: string })[] = [f.label];
    for (let m = 1; m <= 12; m++) {
      const colL = String.fromCharCode(65 + m);
      if (f.formula) values.push({ formula: f.formula(m) });
      else if (f.subtotal === "ingresos") values.push({ formula: `SUM(${colL}${ingresosStart}:${colL}${ingresosEnd})` });
      else if (f.subtotal === "egresos") values.push({ formula: `SUM(${colL}${egresosStart}:${colL}${egresosEnd})` });
      else if (f.neto) values.push({ formula: `${colL}${rowOfIngresosTotal}-${colL}${rowOfEgresosTotal}` });
      else if (f.saldo) {
        if (m === 1) values.push({ formula: `SALDO_INICIAL+${colL}${rowOfNeto}` });
        else {
          const prev = String.fromCharCode(65 + (m - 1));
          values.push({ formula: `${prev}${rowOfSaldo}+${colL}${rowOfNeto}` });
        }
      }
    }
    if (f.saldo) values.push({ formula: `M${rowOfSaldo}` });
    else values.push({ formula: `SUM(B${r}:M${r})` });

    const row = ws.addRow(values);
    for (let c = 2; c <= 14; c++) moneyFmt(row.getCell(c));
    if (f.subtotal === "ingresos") {
      row.font = { bold: true, color: { argb: "FF15803D" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_INGRESO } };
    } else if (f.subtotal === "egresos") {
      row.font = { bold: true, color: { argb: "FFB91C1C" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_EGRESO } };
    } else if (f.neto) {
      row.font = { bold: true };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };
    } else if (f.saldo) {
      row.font = { bold: true, color: { argb: "FF6D28D9" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_SALDO } };
    }
  });

  setWidths(ws, [32, ...new Array(12).fill(11), 13]);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
}

// ============================================================================
// PESTAÑA: Cobranza Mensual (pivot Paciente × Mes — TODO lo cobrado)
// ============================================================================

function pestCobranzaMensual(
  wb: ExcelJS.Workbook,
  anio: number,
  pacientes: Paciente[],
) {
  const ws = wb.addWorksheet("Cobranza Mensual", { properties: { tabColor: { argb: "FF22C55E" } } });
  const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // Título
  ws.mergeCells("A1:N1");
  ws.getCell("A1").value = `💰 Cobranza ${anio} — cuánto pagó cada paciente cada mes (terapias + citas + evaluaciones)`;
  ws.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF065F46" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.addRow([]);
  ws.addRow(["Paciente", ...MESES_CORTO, "Total Año"]);
  applyHeader(ws, 3, [{}, ...new Array(13).fill({ calc: true })]);

  pacientes.forEach((p, i) => {
    const r = 4 + i;
    const nombreEscaped = p.nombre.replace(/"/g, '""');
    const values: (string | number | { formula: string })[] = [p.nombre];
    for (let m = 1; m <= 12; m++) {
      // Suma desde Terapias (col L "Pagado") + Citas (col H) + Evaluaciones (col H)
      // donde el paciente y el mes coincidan
      const fxTerapias = `SUMIFS(Terapias!$L:$L,Terapias!$A:$A,"${nombreEscaped}",Terapias!$B:$B,${m})`;
      const fxCitas = `SUMIFS(Citas!$H:$H,Citas!$C:$C,"${nombreEscaped}",Citas!$A:$A,">="&DATE(${anio},${m},1),Citas!$A:$A,"<"&DATE(${anio},${m + 1},1))`;
      const fxEval = `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$C:$C,"${nombreEscaped}",Evaluaciones!$A:$A,">="&DATE(${anio},${m},1),Evaluaciones!$A:$A,"<"&DATE(${anio},${m + 1},1))`;
      values.push({ formula: `(${fxTerapias})+(${fxCitas})+(${fxEval})` });
    }
    values.push({ formula: `SUM(B${r}:M${r})` });
    const row = ws.addRow(values);
    for (let c = 2; c <= 14; c++) moneyFmt(row.getCell(c));
    // Negrita en columna Total
    row.getCell(14).font = { bold: true };
  });

  // Fila de TOTAL del mes (suma de todos los pacientes)
  if (pacientes.length > 0) {
    const last = pacientes.length + 3;
    const totalValues: (string | { formula: string })[] = ["TOTAL DEL MES"];
    for (let m = 1; m <= 12; m++) {
      const col = String.fromCharCode(65 + m); // B..M
      totalValues.push({ formula: `SUM(${col}4:${col}${last})` });
    }
    totalValues.push({ formula: `SUM(B${last + 1}:M${last + 1})` });
    totalRow(ws, totalValues, Array.from({ length: 13 }, (_, i) => i + 2));
  }

  setWidths(ws, [32, ...new Array(12).fill(11), 13]);
  ws.views = [{ state: "frozen", ySplit: 3, xSplit: 1 }];
  // Auto-filter sobre encabezado para que el usuario pueda filtrar pacientes
  ws.autoFilter = `A3:N3`;
}

// ============================================================================
// PESTAÑA: Cobranza Detallada (Paciente × Mes × {Forma, Subtotal, IVA, Total})
// ============================================================================

function pestCobranzaDetallada(
  wb: ExcelJS.Workbook,
  anio: number,
  pacientes: Paciente[],
  pagos: PagoTerapia[],
) {
  const ws = wb.addWorksheet("Cobranza Detallada", { properties: { tabColor: { argb: "FF22C55E" } } });
  const MESES_LARGO = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

  // Título
  const totalCols = 1 + 12 * 4 + 1; // Paciente + 12 meses × 4 + Total
  ws.mergeCells(1, 1, 1, totalCols);
  ws.getCell(1, 1).value = `💳 Cobranza Detallada ${anio} — cuánto y cómo pagó cada paciente cada mes`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FF065F46" } };
  ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
  ws.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells(2, 1, 2, totalCols);
  ws.getCell(2, 1).value = "Por cada mes: Forma de pago · Subtotal sin IVA · IVA · Total Pagado";
  ws.getCell(2, 1).font = { italic: true, color: { argb: "FF065F46" }, size: 10 };
  ws.getCell(2, 1).alignment = { horizontal: "center" };

  // Headers de dos niveles
  // Fila 3: A=Paciente (merged 2 filas); B..E=ENERO (merged 4 cols); F..I=FEBRERO; ...; última=Total Año (merged 2 filas)
  // Fila 4: A=""; B=Forma C=Subtotal D=IVA E=Total; F..I idem; ...

  ws.mergeCells(3, 1, 4, 1); // Paciente
  ws.getCell(3, 1).value = "Paciente";

  for (let m = 0; m < 12; m++) {
    const startCol = 2 + m * 4;
    ws.mergeCells(3, startCol, 3, startCol + 3);
    const cell = ws.getCell(3, startCol);
    cell.value = MESES_LARGO[m];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_EDIT } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };

    // Sub-headers
    const sub = ["Forma", "Subtotal s/IVA", "IVA", "Total"];
    sub.forEach((s, i) => {
      const sc = ws.getCell(4, startCol + i);
      sc.value = s;
      sc.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      sc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i === 0 ? COLOR_HEADER_EDIT : COLOR_HEADER_CALC } };
      sc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      sc.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } },
      };
    });
  }

  ws.mergeCells(3, totalCols, 4, totalCols);
  const totalCell = ws.getCell(3, totalCols);
  totalCell.value = "Total Año";
  totalCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  totalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_CALC } };
  totalCell.alignment = { horizontal: "center", vertical: "middle" };

  // Header del paciente con estilo
  const pacHdr = ws.getCell(3, 1);
  pacHdr.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  pacHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER_EDIT } };
  pacHdr.alignment = { horizontal: "center", vertical: "middle" };

  ws.getRow(3).height = 24;
  ws.getRow(4).height = 30;

  // Construir mapa: (paciente_id, mes) → { forma, total }
  // Si hay múltiples pagos con distintas formas en un mes, "Mixto"
  const pagosAnio = pagos.filter((p) => p.anio === anio);
  const pagoMap = new Map<string, { forma: string; total: number }>();
  for (const p of pagosAnio) {
    const key = `${p.paciente_id}|${p.mes}`;
    const existing = pagoMap.get(key);
    if (!existing) {
      pagoMap.set(key, { forma: p.forma_pago, total: Number(p.monto_pagado ?? 0) });
    } else {
      existing.total += Number(p.monto_pagado ?? 0);
      if (existing.forma !== p.forma_pago) existing.forma = "Mixto";
    }
  }

  // Filas de pacientes — solo los que tienen al menos un pago este año
  const pacientesConPago = pacientes.filter((p) =>
    Array.from(pagoMap.keys()).some((k) => k.startsWith(`${p.id}|`)),
  );

  pacientesConPago.forEach((p, i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = p.nombre;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 1).alignment = { vertical: "middle" };

    for (let m = 1; m <= 12; m++) {
      const startCol = 2 + (m - 1) * 4;
      const dato = pagoMap.get(`${p.id}|${m}`);
      const formaCell = ws.getCell(r, startCol);
      const subCell = ws.getCell(r, startCol + 1);
      const ivaCell = ws.getCell(r, startCol + 2);
      const totalCellCol = ws.getCell(r, startCol + 3);

      if (!dato || dato.total === 0) {
        // Mes sin pago
        formaCell.value = "—";
        formaCell.font = { color: { argb: "FFD1D5DB" }, italic: true };
        formaCell.alignment = { horizontal: "center" };
        subCell.value = null;
        ivaCell.value = null;
        totalCellCol.value = null;
      } else {
        formaCell.value = dato.forma;
        formaCell.alignment = { horizontal: "center" };
        // Color según forma
        const colorForma = dato.forma === "Efectivo" ? "FFFEF3C7" : "FFEFE4FF";
        formaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorForma } };

        totalCellCol.value = dato.total;
        moneyFmt(totalCellCol);

        const formaLetter = ws.getColumn(startCol).letter;
        const totalLetter = ws.getColumn(startCol + 3).letter;
        const subLetter = ws.getColumn(startCol + 1).letter;
        // Subtotal sin IVA = total/(1+IVA) si forma != Efectivo, else total
        subCell.value = {
          formula: `IF(${formaLetter}${r}="Efectivo",${totalLetter}${r},${totalLetter}${r}/(1+IVA))`,
        };
        moneyFmt(subCell);
        subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };

        // IVA = total - subtotal
        ivaCell.value = {
          formula: `${totalLetter}${r}-${subLetter}${r}`,
        };
        moneyFmt(ivaCell);
        ivaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      }
    }

    // Total Año = suma de las 12 columnas "Total" (las que son cada 4 a partir de E)
    // Cols: E, I, M, Q, U, Y, AC, AG, AK, AO, AS, AW
    const totalCols: string[] = [];
    for (let m = 0; m < 12; m++) {
      totalCols.push(ws.getColumn(2 + m * 4 + 3).letter + r);
    }
    const totalAnoCell = ws.getCell(r, 1 + 12 * 4 + 1);
    totalAnoCell.value = { formula: totalCols.join("+") };
    moneyFmt(totalAnoCell);
    totalAnoCell.font = { bold: true };
    totalAnoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  });

  // Fila TOTAL del mes (suma de todos los pacientes)
  if (pacientesConPago.length > 0) {
    const last = pacientesConPago.length + 4;
    const totalRowNum = last + 1;
    ws.getCell(totalRowNum, 1).value = "TOTAL DEL MES";
    ws.getCell(totalRowNum, 1).font = { bold: true };
    ws.getCell(totalRowNum, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };

    for (let m = 0; m < 12; m++) {
      const startCol = 2 + m * 4;
      // Forma → vacío
      ws.getCell(totalRowNum, startCol).value = null;
      // Subtotal, IVA, Total → sumas
      for (let j = 1; j <= 3; j++) {
        const colLetter = ws.getColumn(startCol + j).letter;
        const cell = ws.getCell(totalRowNum, startCol + j);
        cell.value = { formula: `SUM(${colLetter}5:${colLetter}${last})` };
        moneyFmt(cell);
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };
      }
    }
    // Total Año
    const totalAnoCol = ws.getColumn(1 + 12 * 4 + 1).letter;
    const cellAno = ws.getCell(totalRowNum, 1 + 12 * 4 + 1);
    cellAno.value = { formula: `SUM(${totalAnoCol}5:${totalAnoCol}${last})` };
    moneyFmt(cellAno);
    cellAno.font = { bold: true };
    cellAno.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_TOTAL } };
  }

  // Anchos: paciente ancho, sub-cols delgadas
  ws.getColumn(1).width = 28;
  for (let m = 0; m < 12; m++) {
    const start = 2 + m * 4;
    ws.getColumn(start).width = 11;     // Forma
    ws.getColumn(start + 1).width = 10; // Subtotal
    ws.getColumn(start + 2).width = 8;  // IVA
    ws.getColumn(start + 3).width = 10; // Total
  }
  ws.getColumn(1 + 12 * 4 + 1).width = 12; // Total Año

  ws.views = [{ state: "frozen", ySplit: 4, xSplit: 1 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: totalCols } };
}

// ============================================================================
// PESTAÑA: Para el Contador (matriz Cliente × Mes — SOLO facturables)
// ============================================================================

function pestParaContador(
  wb: ExcelJS.Workbook,
  anio: number,
  pacientes: Paciente[],
  pagos: PagoTerapia[],
  eventos: Evento[],
  subarr: Subarrendamiento[],
) {
  const ws = wb.addWorksheet("Para el Contador", { properties: { tabColor: { argb: "FFFBBF24" } } });
  const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // Título + instrucciones
  ws.mergeCells("A1:N1");
  ws.getCell("A1").value = `📋 Facturas ${anio} — clientes con cobro por transferencia / tarjeta / depósito`;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF92400E" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  ws.mergeCells("A2:N2");
  ws.getCell("A2").value = "Cada celda muestra el monto TOTAL CON IVA cobrado al cliente en ese mes (solo cobros NO efectivo). Si la celda está vacía, no hubo cobro facturable.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF92400E" }, size: 10 };
  ws.getCell("A2").alignment = { horizontal: "center", wrapText: true };
  ws.getRow(2).height = 28;

  ws.addRow([]);
  ws.addRow(["Cliente", ...MESES_CORTO, "Total Año"]);
  applyHeader(ws, 4, [{}, ...new Array(13).fill({ calc: true })]);

  // Construir set único de clientes (terapias + eventos + subarrendamiento) que tengan AL MENOS 1 cobro facturable
  const FORMAS_FACT = new Set(["Transferencia", "Tarjeta", "Depósito"]);
  const pacMap = new Map(pacientes.map((p) => [p.id, p]));
  const clientes = new Set<string>();

  for (const p of pagos.filter((p) => p.anio === anio && FORMAS_FACT.has(p.forma_pago))) {
    const nombre = pacMap.get(p.paciente_id)?.nombre || p.paciente_nombre;
    if (nombre) clientes.add(nombre);
  }
  for (const ev of eventos) {
    if (!ev.fecha?.startsWith(String(anio))) continue;
    if (!FORMAS_FACT.has(ev.forma_pago)) continue;
    if (!ev.monto_pagado || ev.monto_pagado <= 0) continue;
    if (ev.nombre_paciente) clientes.add(ev.nombre_paciente);
  }
  for (const s of subarr) {
    if (s.anio !== anio || !FORMAS_FACT.has(s.forma_pago)) continue;
    if (!s.monto_cobrado || s.monto_cobrado <= 0) continue;
    clientes.add(s.inquilino);
  }

  const clientesOrdenados = Array.from(clientes).sort((a, b) => a.localeCompare(b));

  clientesOrdenados.forEach((cliente, i) => {
    const r = 5 + i;
    const esc = cliente.replace(/"/g, '""');
    const values: (string | { formula: string })[] = [cliente];
    for (let m = 1; m <= 12; m++) {
      // Terapias: monto_pagado en pesos ya con IVA si transferencia (cliente captura "lo que recibí")
      // Citas y Evaluaciones: monto_pagado sin IVA. Para mostrar TOTAL CON IVA en facturable, multiplicar por (1+IVA).
      // Subarrendamiento: monto_cobrado ya con IVA.
      const fxTerapias = `SUMIFS(Terapias!$L:$L,Terapias!$A:$A,"${esc}",Terapias!$B:$B,${m},Terapias!$F:$F,"<>Efectivo")`;
      const fxCitas = `SUMIFS(Citas!$H:$H,Citas!$C:$C,"${esc}",Citas!$A:$A,">="&DATE(${anio},${m},1),Citas!$A:$A,"<"&DATE(${anio},${m + 1},1),Citas!$D:$D,"<>Efectivo")*(1+IVA)`;
      const fxEval = `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$C:$C,"${esc}",Evaluaciones!$A:$A,">="&DATE(${anio},${m},1),Evaluaciones!$A:$A,"<"&DATE(${anio},${m + 1},1),Evaluaciones!$D:$D,"<>Efectivo")*(1+IVA)`;
      const fxSubarr = `SUMIFS(Subarrendamiento!$D:$D,Subarrendamiento!$A:$A,"${esc}",Subarrendamiento!$B:$B,${m},Subarrendamiento!$C:$C,"<>Efectivo")`;
      values.push({ formula: `(${fxTerapias})+(${fxCitas})+(${fxEval})+(${fxSubarr})` });
    }
    values.push({ formula: `SUM(B${r}:M${r})` });
    const row = ws.addRow(values);
    for (let c = 2; c <= 14; c++) moneyFmt(row.getCell(c));
    row.getCell(14).font = { bold: true };
  });

  // Fila TOTAL del mes
  if (clientesOrdenados.length > 0) {
    const last = clientesOrdenados.length + 4;
    const totalValues: (string | { formula: string })[] = ["TOTAL DEL MES"];
    for (let m = 1; m <= 12; m++) {
      const col = String.fromCharCode(65 + m);
      totalValues.push({ formula: `SUM(${col}5:${col}${last})` });
    }
    totalValues.push({ formula: `SUM(B${last + 1}:M${last + 1})` });
    totalRow(ws, totalValues, Array.from({ length: 13 }, (_, i) => i + 2));
  }

  setWidths(ws, [32, ...new Array(12).fill(11), 13]);
  ws.views = [{ state: "frozen", ySplit: 4, xSplit: 1 }];
  ws.autoFilter = `A4:N4`;
}

// ============================================================================
// PESTAÑA: Gastos por Categoría (pivot Categoría × Mes)
// ============================================================================

function pestGastosCategoria(wb: ExcelJS.Workbook, anio: number) {
  const ws = wb.addWorksheet("Gastos por Categoría", { properties: { tabColor: { argb: "FFEF4444" } } });
  const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const CATEGORIAS = [
    "Renta", "Materiales Centro", "Materiales Limpieza", "Comidas", "Servicios",
    "Renta Terapeutas", "Capacitaciones", "Nómina", "Impuestos", "Otros",
  ];

  ws.mergeCells("A1:N1");
  ws.getCell("A1").value = `📊 Gastos ${anio} — por categoría y mes`;
  ws.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF991B1B" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.addRow([]);
  ws.addRow(["Categoría", ...MESES_CORTO, "Total Año"]);
  applyHeader(ws, 3, [{}, ...new Array(13).fill({ calc: true })]);

  CATEGORIAS.forEach((cat, i) => {
    const r = 4 + i;
    const values: (string | { formula: string })[] = [cat];
    for (let m = 1; m <= 12; m++) {
      values.push({ formula: `SUMIFS(Gastos!$H:$H,Gastos!$C:$C,"${cat}",Gastos!$B:$B,${m})` });
    }
    values.push({ formula: `SUM(B${r}:M${r})` });
    const row = ws.addRow(values);
    for (let c = 2; c <= 14; c++) moneyFmt(row.getCell(c));
    row.getCell(14).font = { bold: true };
  });

  // Total mes (suma de todas las categorías)
  const lastCat = CATEGORIAS.length + 3;
  const totalValues: (string | { formula: string })[] = ["TOTAL DEL MES"];
  for (let m = 1; m <= 12; m++) {
    const col = String.fromCharCode(65 + m);
    totalValues.push({ formula: `SUM(${col}4:${col}${lastCat})` });
  }
  totalValues.push({ formula: `SUM(B${lastCat + 1}:M${lastCat + 1})` });
  totalRow(ws, totalValues, Array.from({ length: 13 }, (_, i) => i + 2));

  setWidths(ws, [22, ...new Array(12).fill(11), 13]);
  ws.views = [{ state: "frozen", ySplit: 3, xSplit: 1 }];
}

// ============================================================================
// 11. PESTAÑA: Parámetros
// ============================================================================

function pestParametros(wb: ExcelJS.Workbook, params: ParamMap) {
  const ws = wb.addWorksheet("Parámetros", { properties: { tabColor: { argb: "FFBBBBBB" } } });
  ws.addRow(["Clave", "Valor", "Descripción"]);
  applyHeader(ws, 1, [{}, {}, {}]);

  const defs: { clave: string; valor: number; desc: string; named: string; isMoney?: boolean }[] = [
    { clave: "iva",                      valor: Number(params.iva ?? 0.16),                  desc: "Tasa IVA",                                 named: "IVA" },
    { clave: "recargo_pago_tarde",       valor: Number(params.recargo_pago_tarde ?? 0.10),   desc: "Recargo por pago tardío",                  named: "RECARGO" },
    { clave: "dia_tope_pago",            valor: Number(params.dia_tope_pago ?? 10),          desc: "Día tope para pago sin recargo",           named: "DIA_TOPE" },
    { clave: "precio_terapia_regular",   valor: Number(params.precio_terapia_regular ?? 1100), desc: "Precio sesión regular global",          named: "PRECIO_REG", isMoney: true },
    { clave: "precio_terapia_matutina",  valor: Number(params.precio_terapia_matutina ?? 900), desc: "Precio sesión matutina global",         named: "PRECIO_MAT", isMoney: true },
    { clave: "imss_patronal_tasa",       valor: 0.30,                                        desc: "Tasa IMSS Patronal aproximada",            named: "IMSS_TASA" },
    { clave: "isn_nl",                   valor: Number(params.isn_nl ?? 0.03),               desc: "ISN Nuevo León",                           named: "ISN_TASA" },
    { clave: "factor_bruto_neto",        valor: 1.0452,                                      desc: "Factor de integración SBC",                named: "FACTOR_INT" },
    { clave: "uma_diaria",               valor: 117.31,                                      desc: "UMA diaria 2026 (DOF)",                    named: "UMA" },
    { clave: "dias_aguinaldo",           valor: Number(params.dias_aguinaldo ?? 15),         desc: "Días de aguinaldo LFT mínimo",             named: "DIAS_AGUINALDO" },
    { clave: "saldo_inicial_caja",       valor: Number(params.saldo_inicial_caja ?? 100000), desc: "Saldo inicial de caja (Enero)",            named: "SALDO_INICIAL", isMoney: true },
  ];

  defs.forEach((d, i) => {
    const r = i + 2;
    ws.addRow([d.clave, d.valor, d.desc]);
    wb.definedNames.add(`'Parámetros'!$B$${r}`, d.named);
    if (d.isMoney) moneyFmt(ws.getRow(r).getCell(2));
    else ws.getRow(r).getCell(2).numFmt = "0.0000";
  });

  setWidths(ws, [28, 14, 42]);
}

// ============================================================================
// 12. PESTAÑA: Tablas (LISR + LFT vacaciones)
// ============================================================================

function pestTablas(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Tablas", { properties: { tabColor: { argb: "FFBBBBBB" } } });

  ws.addRow(["TABLA ISR MENSUAL (Art. 96 LISR)"]);
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.addRow(["Lím. Inferior", "Lím. Superior", "Cuota Fija", "Tasa"]);
  applyHeader(ws, 2, [{}, {}, {}, {}]);
  TARIFA_ISR.forEach((t, i) => {
    const r = i + 3;
    ws.addRow([t.li, t.ls === Infinity ? 99999999 : t.ls, t.cuota, t.tasa]);
    moneyFmt(ws.getRow(r).getCell(1));
    moneyFmt(ws.getRow(r).getCell(2));
    moneyFmt(ws.getRow(r).getCell(3));
    ws.getRow(r).getCell(4).numFmt = "0.0000";
  });
  const lastIsr = TARIFA_ISR.length + 2;
  wb.definedNames.add(`'Tablas'!$A$3:$D$${lastIsr}`, "TABLA_ISR");

  ws.addRow([]);
  ws.addRow(["TABLA VACACIONES LFT (Art. 76)"]);
  ws.getCell(`A${lastIsr + 2}`).font = { bold: true, size: 12 };
  ws.addRow(["Años Antigüedad", "Días Vacaciones"]);
  applyHeader(ws, lastIsr + 3, [{}, {}]);
  TABLA_VACACIONES_LFT.forEach((t) => ws.addRow([t.anios, t.dias]));
  const vacStart = lastIsr + 4;
  const vacEnd = vacStart + TABLA_VACACIONES_LFT.length - 1;
  wb.definedNames.add(`'Tablas'!$A$${vacStart}:$B$${vacEnd}`, "TABLA_VAC");

  setWidths(ws, [16, 16, 14, 10]);
}

// ============================================================================
// 13. PESTAÑA: Cómo usar este Excel
// ============================================================================

function pestComoUsar(wb: ExcelJS.Workbook, anio: number) {
  const ws = wb.addWorksheet("Cómo usar", { properties: { tabColor: { argb: "FF6D28D9" } } });
  ws.getColumn(1).width = 100;

  const addH = (text: string, size = 14) => {
    const row = ws.addRow([text]);
    row.font = { bold: true, size };
    row.height = size + 8;
  };
  const addP = (text: string, italic = false) => {
    const row = ws.addRow([text]);
    row.font = { italic, color: italic ? { argb: "FF6B7280" } : undefined };
    row.alignment = { wrapText: true, vertical: "top" };
    row.height = 18;
  };

  addH(`Respaldo Flujo Consentido — Año ${anio}`, 16);
  addP(`Generado ${new Date().toLocaleString("es-MX")}`, true);
  ws.addRow([]);

  addH("¿Cómo está organizado?", 12);
  addP("Las pestañas se ordenan en 3 bloques:");
  addP("");
  addP("  📝 EDITABLES (donde haces cambios): Pacientes, Empleados, Terapias, Citas, Evaluaciones, Subarrendamiento, Gastos, Nómina");
  addP("  📊 RESÚMENES (calculados automáticamente): Flujo de Efectivo, Para el Contador");
  addP("  ⚙️ CONFIG (rara vez se toca): Parámetros, Tablas");
  ws.addRow([]);

  addH("Colores", 12);
  addP("  🟣 Header MORADO = columna donde puedes escribir / editar");
  addP("  ⬜ Header GRIS = columna calculada con fórmula (NO escribir, se recalcula sola)");
  addP("  🟡 Fila TOTAL amarilla = suma de las filas de arriba");
  ws.addRow([]);

  addH("Cómo se recalcula", 12);
  addP("• Cambia el IVA en pestaña Parámetros → TODAS las pestañas recalculan IVA y totales");
  addP("• Cambia el precio global en Parámetros → Terapias recalcula totales (de quienes usan precio global)");
  addP("• Cambia las sesiones de un paciente en Terapias → Subtotal/IVA/Total/Saldo se recalculan");
  addP("• Cambia la forma de pago de un cobro → IVA se activa o se quita automáticamente");
  addP("• Cambia el sueldo de un empleado en Nómina → IMSS, ISN, ISR, Infonavit, Total Costo recalculan");
  ws.addRow([]);

  addH("Flujo de trabajo con cambios", 12);
  addP("1) Abres este Excel y ves los datos actuales de la app.");
  addP("2) Si quieres explorar 'qué pasa si...' (cambiar precios, agregar pacientes, etc), edita las celdas moradas y verás cómo afectan totales y flujo.");
  addP("3) Si decides que los cambios son los correctos, manda el Excel y pídele a Claude que actualice la app en la BD para reflejarlos.");
  ws.addRow([]);

  addH("Para el contador", 12);
  addP("• Abre la pestaña 'Para el Contador'.");
  addP("• Usa el filtro de la columna 'Forma de Pago' y selecciona Transferencia / Tarjeta / Depósito.");
  addP("• Esa lista filtrada es exactamente la que necesita facturar (con Subtotal sin IVA, IVA, Total).");
  ws.addRow([]);

  addH("Limitaciones", 12);
  addP("• IMSS Patronal e ISR Retenido en Nómina usan aproximación lineal (~95% exacto). La app usa gross-up iterativo más preciso. Si necesitas el número exacto al peso, consulta la app /nomina.", true);
  addP("• Cambios en este Excel NO afectan la app. Para que reflejen, hay que actualizar la BD desde la web (o pedirle a Claude que lo haga).", true);
}

// ============================================================================
// EXPORT PRINCIPAL
// ============================================================================

export async function generarExcelRespaldo(anio: number): Promise<Blob> {
  const [parametros, pacientesRaw, empleados, sesiones, pagos, eventos, subarr, gastos, nomina] = await Promise.all([
    db.parametro.list("clave"),
    db.paciente.list("nombre", 1000),
    db.empleado.list("nombre", 200),
    db.sesion_mensual.list("-created_date", 5000),
    db.pago_terapia.list("-created_date", 5000),
    db.evento.list("-fecha", 2000),
    db.subarrendamiento.list("-created_date", 500),
    db.gasto.list("-fecha", 10000),
    db.nomina_mensual.list("-created_date", 2000),
  ]);

  const pacientes = dedupPacientes(pacientesRaw);
  const paramsMap = paramsToMap(parametros);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Flujo Consentido";
  wb.created = new Date();
  wb.modified = new Date();

  // Parámetros y Tablas primero para registrar named ranges
  pestParametros(wb, paramsMap);
  pestTablas(wb);

  // Editables
  pestPacientes(wb, pacientes);
  pestCobranzaMensual(wb, anio, pacientes);
  pestCobranzaDetallada(wb, anio, pacientes, pagos);
  pestEmpleados(wb, empleados);
  pestTerapias(wb, anio, pacientes, sesiones, pagos);
  pestEventos(wb, anio, eventos, "citas");
  pestEventos(wb, anio, eventos, "evaluaciones");
  pestSubarrendamiento(wb, anio, subarr);
  pestGastos(wb, anio, gastos);
  pestGastosCategoria(wb, anio);
  pestNomina(wb, anio, empleados, nomina);

  // Resúmenes
  pestFlujoEfectivo(wb, anio);
  pestParaContador(wb, anio, pacientes, pagos, eventos, subarr);

  // Cómo usar
  pestComoUsar(wb, anio);

  // Reordenar: editables primero, resúmenes después, config al final
  const ws = wb.worksheets;
  const reordered = [
    "Pacientes",
    "Cobranza Mensual", "Cobranza Detallada",
    "Empleados",
    "Terapias", "Citas", "Evaluaciones",
    "Subarrendamiento",
    "Gastos", "Gastos por Categoría",
    "Nómina",
    "Flujo de Efectivo", "Para el Contador",
    "Cómo usar",
    "Parámetros", "Tablas",
  ];
  reordered.forEach((name, idx) => {
    const sheet = ws.find((s) => s.name === name) as (ExcelJS.Worksheet & { orderNo?: number }) | undefined;
    if (sheet) sheet.orderNo = idx;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
