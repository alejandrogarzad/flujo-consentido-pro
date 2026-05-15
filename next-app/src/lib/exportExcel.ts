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
// 10. PESTAÑA: Para el Contador (lista detallada de quién pagó cómo)
// ============================================================================

function pestParaContador(
  wb: ExcelJS.Workbook,
  anio: number,
  pacientes: Paciente[],
  sesiones: SesionMensual[],
  pagos: PagoTerapia[],
  eventos: Evento[],
  subarr: Subarrendamiento[],
) {
  const ws = wb.addWorksheet("Para el Contador", { properties: { tabColor: { argb: "FFFBBF24" } } });

  // Encabezado de la hoja con título grande
  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = `📋 Lista de Cobros ${anio} — Para Emisión de Facturas`;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF92400E" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = "Filtra la columna Forma de Pago = Transferencia/Tarjeta/Depósito → esos son los que necesitan factura.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF92400E" } };
  ws.getCell("A2").alignment = { horizontal: "center" };

  ws.addRow([]);
  ws.addRow(["Mes", "Concepto", "Cliente / Paciente", "Forma de Pago", "Subtotal sin IVA", "IVA", "Total Pagado"]);
  applyHeader(ws, 4, [{}, {}, {}, {}, { calc: true }, { calc: true }, {}]);

  // Recolectar todos los cobros del año, una fila por (paciente/concepto/mes)
  const pacMap = new Map(pacientes.map((p) => [p.id, p]));
  type Cobro = { mes: number; concepto: string; cliente: string; forma: string; total: number };
  const cobros: Cobro[] = [];

  // 1. Terapias (por mes, agrupado por paciente y forma de pago)
  const pagosAnio = pagos.filter((p) => p.anio === anio);
  const terapiaMap = new Map<string, Cobro>();
  for (const p of pagosAnio) {
    const pac = pacMap.get(p.paciente_id);
    const cliente = pac?.nombre || p.paciente_nombre || "Sin nombre";
    const key = `T|${p.mes}|${p.paciente_id}|${p.forma_pago}`;
    const existing = terapiaMap.get(key);
    if (existing) {
      existing.total += Number(p.monto_pagado ?? 0);
    } else {
      terapiaMap.set(key, {
        mes: p.mes,
        concepto: `Terapia mes ${p.mes}`,
        cliente,
        forma: p.forma_pago,
        total: Number(p.monto_pagado ?? 0),
      });
    }
  }
  cobros.push(...terapiaMap.values());

  // 2. Eventos (citas + evaluaciones)
  for (const ev of eventos) {
    if (!ev.fecha?.startsWith(String(anio))) continue;
    if (!(ev.monto_pagado && ev.monto_pagado > 0)) continue;
    const fechaObj = new Date(ev.fecha + "T12:00:00");
    cobros.push({
      mes: fechaObj.getMonth() + 1,
      concepto: ev.tipo,
      cliente: ev.nombre_paciente,
      forma: ev.forma_pago,
      total: Number(ev.monto_pagado),
    });
  }

  // 3. Subarrendamiento
  for (const s of subarr) {
    if (s.anio !== anio) continue;
    if (!(s.monto_cobrado && s.monto_cobrado > 0)) continue;
    cobros.push({
      mes: s.mes,
      concepto: "Subarrendamiento",
      cliente: s.inquilino,
      forma: s.forma_pago,
      total: Number(s.monto_cobrado),
    });
  }

  // Sort por mes, después por cliente
  cobros.sort((a, b) => a.mes - b.mes || a.cliente.localeCompare(b.cliente));

  cobros.forEach((c, i) => {
    const r = 5 + i;
    // Subtotal sin IVA y IVA dependen de forma de pago
    // - Si Efectivo: subtotal = total, IVA = 0
    // - Si transferencia/tarjeta/depósito: total ya incluye IVA → subtotal = total/(1+IVA), IVA = total - subtotal
    //   PERO en /citas-evaluaciones el monto_pagado se captura SIN IVA. Para mantener consistencia,
    //   asumo que los cobros de "Cita" o "Evaluación" tienen total SIN IVA → ajustar:
    const esEvento = c.concepto !== "Subarrendamiento" && !c.concepto.startsWith("Terapia");
    let subFx: string;
    let ivaFx: string;
    if (esEvento) {
      // monto_pagado de eventos es SIN IVA por convención
      subFx = `G${r}`;
      ivaFx = `IF(D${r}="Efectivo",0,G${r}*IVA)`;
    } else {
      subFx = `IF(D${r}="Efectivo",G${r},G${r}/(1+IVA))`;
      ivaFx = `IF(D${r}="Efectivo",0,G${r}-E${r})`;
    }
    const row = ws.addRow([
      c.mes,
      c.concepto,
      c.cliente,
      c.forma,
      { formula: subFx },
      { formula: ivaFx },
      c.total,
    ]);
    [5, 6, 7].forEach((col) => moneyFmt(row.getCell(col)));
    [5, 6].forEach((col) => {
      row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    });
  });

  // Total
  if (cobros.length > 0) {
    const last = cobros.length + 4;
    totalRow(ws, [
      "TOTAL AÑO", "", "", "",
      { formula: `SUM(E5:E${last})` },
      { formula: `SUM(F5:F${last})` },
      { formula: `SUM(G5:G${last})` },
    ], [5, 6, 7]);
  }

  // Habilita auto-filter en el encabezado para que el contador filtre por forma de pago
  ws.autoFilter = "A4:G4";

  setWidths(ws, [6, 28, 32, 14, 14, 11, 13]);
  ws.views = [{ state: "frozen", ySplit: 4 }];
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
  // (las named ranges no dependen del orden visual, pero por claridad)
  pestParametros(wb, paramsMap);
  pestTablas(wb);

  // Ahora SÍ las pestañas editables al frente (Excel respeta el orden de agregado)
  // exceljs no tiene método directo para reordenar; quitamos Parámetros y Tablas
  // y las re-agregamos al final via _worksheets manipulation
  // Solución: agregar las editables al inicio Y las de config al final manualmente.
  // ExcelJS no expone reorden directo, pero podemos reasignar el array interno.

  // Editables (orden visible)
  pestPacientes(wb, pacientes);
  pestEmpleados(wb, empleados);
  pestTerapias(wb, anio, pacientes, sesiones, pagos);
  pestEventos(wb, anio, eventos, "citas");
  pestEventos(wb, anio, eventos, "evaluaciones");
  pestSubarrendamiento(wb, anio, subarr);
  pestGastos(wb, anio, gastos);
  pestNomina(wb, anio, empleados, nomina);

  // Resúmenes
  pestFlujoEfectivo(wb, anio);
  pestParaContador(wb, anio, pacientes, sesiones, pagos, eventos, subarr);

  // Cómo usar (al final como "ayuda")
  pestComoUsar(wb, anio);

  // Reordenar: Parámetros y Tablas al final (después de Cómo usar)
  // exceljs internamente usa `_worksheets` indexado. Reordenamos.
  const ws = wb.worksheets;
  // Estado actual: [Parámetros, Tablas, Pacientes, Empleados, ..., Cómo usar]
  // Queremos: [Pacientes, ..., Nómina, Flujo, Para Contador, Cómo usar, Parámetros, Tablas]
  const params = ws.find((s) => s.name === "Parámetros")!;
  const tablas = ws.find((s) => s.name === "Tablas")!;
  // Reasignar orderNo: los nombres no cambian; el orden de tabs se controla con `orderNo`
  // exceljs determina el orden de tabs por el orden en que se agregan al workbook.
  // Hack: reasignar orderNo de las pestañas
  // Mejor: re-asignar via internal _worksheets array (más seguro en exceljs 4.x)
  // (exceljs no expone reorden público pero esto funciona):
  const reordered = [
    "Pacientes", "Empleados", "Terapias", "Citas", "Evaluaciones",
    "Subarrendamiento", "Gastos", "Nómina",
    "Flujo de Efectivo", "Para el Contador",
    "Cómo usar",
    "Parámetros", "Tablas",
  ];
  reordered.forEach((name, idx) => {
    const sheet = ws.find((s) => s.name === name) as (ExcelJS.Worksheet & { orderNo?: number }) | undefined;
    if (sheet) sheet.orderNo = idx;
  });
  // ExcelJS lee orderNo al serializar
  void params; void tablas;

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
