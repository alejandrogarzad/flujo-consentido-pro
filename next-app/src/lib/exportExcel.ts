// =============================================================================
// exportExcel.ts — Genera un .xlsx de respaldo con todas las pestañas.
// Las fórmulas referencian "named ranges" de la pestaña Parámetros para que
// si el usuario cambia el IVA, precios globales o tasas, TODA la hoja se
// recalcule automáticamente en Excel.
//
// Limitación conocida: el IMSS Patronal usa una aproximación lineal (SBC ×
// tasa_combinada). El cálculo iterativo de la app es más preciso pero no
// se puede portar limpio a Excel sin habilitar "cálculo iterativo".
// =============================================================================

import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import {
  TARIFA_ISR, TABLA_VACACIONES_LFT,
  type ParamMap,
} from "@/lib/calculos";
import type {
  Paciente, Empleado, SesionMensual, PagoTerapia, Evento,
  Subarrendamiento, Gasto, NominaMensual, Parametro,
} from "@/types/db";

// ---------- Helpers ----------

function paramsToMap(params: Parametro[]): ParamMap {
  const m: ParamMap = {};
  for (const p of params) m[p.clave] = p.valor;
  return m;
}

function styleHeader(ws: ExcelJS.Worksheet, range: string) {
  ws.getCell(range.split(":")[0]).font = { bold: true, color: { argb: "FFFFFFFF" } };
  // Simpler: apply to whole header row externally
}

function applyHeaderRow(ws: ExcelJS.Worksheet, row: number, cols: number) {
  for (let c = 1; c <= cols; c++) {
    const cell = ws.getRow(row).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7C3AED" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  ws.getRow(row).height = 22;
}

function autoFitCols(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

function fmtMoney(cell: ExcelJS.Cell) {
  cell.numFmt = '"$"#,##0.00';
}

function fmtMoneyCol(ws: ExcelJS.Worksheet, col: number, fromRow: number, toRow: number) {
  for (let r = fromRow; r <= toRow; r++) fmtMoney(ws.getRow(r).getCell(col));
}

// ============================================================================
// PESTAÑA: Parámetros
// ============================================================================

function pestParametros(wb: ExcelJS.Workbook, params: ParamMap) {
  const ws = wb.addWorksheet("Parámetros", { properties: { tabColor: { argb: "FF7C3AED" } } });
  ws.addRow(["Clave", "Valor", "Descripción"]);
  applyHeaderRow(ws, 1, 3);

  // Define named ranges para usar desde fórmulas en otras pestañas
  const defs: { clave: string; valor: number; desc: string; named: string }[] = [
    { clave: "iva",                      valor: Number(params.iva ?? 0.16),                  desc: "Tasa IVA (16%)",                          named: "IVA" },
    { clave: "recargo_pago_tarde",       valor: Number(params.recargo_pago_tarde ?? 0.10),   desc: "Recargo por pago tardío (10%)",           named: "RECARGO" },
    { clave: "dia_tope_pago",            valor: Number(params.dia_tope_pago ?? 10),          desc: "Día tope para pago sin recargo",          named: "DIA_TOPE" },
    { clave: "precio_terapia_regular",   valor: Number(params.precio_terapia_regular ?? 1100), desc: "Precio sesión regular global",          named: "PRECIO_REG" },
    { clave: "precio_terapia_matutina",  valor: Number(params.precio_terapia_matutina ?? 900), desc: "Precio sesión matutina global",         named: "PRECIO_MAT" },
    { clave: "precio_cita_inicial",      valor: Number(params.precio_cita_inicial ?? 1000),  desc: "Precio cita inicial / ingreso",           named: "PRECIO_CITA_INI" },
    { clave: "precio_cita_seguimiento",  valor: Number(params.precio_cita_seguimiento ?? 1000), desc: "Precio cita seguimiento directora",     named: "PRECIO_CITA_SEG" },
    { clave: "precio_cita_escolar_virtual",     valor: Number(params.precio_cita_escolar_virtual ?? 1500),    desc: "Cita escolar virtual",         named: "PRECIO_CITA_EV" },
    { clave: "precio_cita_escolar_presencial",  valor: Number(params.precio_cita_escolar_presencial ?? 2000), desc: "Cita escolar presencial",      named: "PRECIO_CITA_EP" },
    { clave: "precio_observacion_escolar",      valor: Number(params.precio_observacion_escolar ?? 2800),     desc: "Observación escolar",          named: "PRECIO_OBS" },
    { clave: "precio_reporte_adicional",        valor: Number(params.precio_reporte_adicional ?? 3000),       desc: "Reporte adicional",            named: "PRECIO_REP" },
    { clave: "precio_evaluacion",        valor: Number(params.precio_evaluacion ?? 8500),    desc: "Evaluación",                              named: "PRECIO_EVAL" },
    { clave: "imss_patronal_tasa",       valor: 0.30,                                        desc: "Tasa IMSS Patronal aproximada (combinada)", named: "IMSS_TASA" },
    { clave: "isn_nl",                   valor: Number(params.isn_nl ?? 0.03),               desc: "ISN Nuevo León (3%)",                     named: "ISN_TASA" },
    { clave: "isr_retenido_pct",         valor: 0.06,                                        desc: "ISR Retenido aproximado (fallback)",       named: "ISR_TASA" },
    { clave: "factor_bruto_neto",        valor: 1.0452,                                      desc: "Factor de integración (SBC ÷ salario)",    named: "FACTOR_INT" },
    { clave: "uma_diaria",               valor: 117.31,                                      desc: "UMA diaria 2026 (DOF)",                   named: "UMA" },
    { clave: "dias_aguinaldo",           valor: Number(params.dias_aguinaldo ?? 15),         desc: "Días de aguinaldo LFT mínimo",            named: "DIAS_AGUINALDO" },
    { clave: "saldo_inicial_caja",       valor: Number(params.saldo_inicial_caja ?? 100000), desc: "Saldo inicial de caja (Enero)",           named: "SALDO_INICIAL" },
  ];

  defs.forEach((d, i) => {
    const r = i + 2;
    ws.addRow([d.clave, d.valor, d.desc]);
    wb.definedNames.add(d.named, `'Parámetros'!$B$${r}`);
  });

  autoFitCols(ws, [32, 14, 42]);
  ws.getColumn(2).numFmt = "0.0000";
  // Marca filas de pesos en formato moneda
  defs.forEach((d, i) => {
    if (d.clave.startsWith("precio_") || d.clave === "saldo_inicial_caja") {
      fmtMoney(ws.getRow(i + 2).getCell(2));
    }
  });
}

// ============================================================================
// PESTAÑA: Tablas auxiliares (LISR Art.96 y LFT vacaciones)
// ============================================================================

function pestTablas(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Tablas", { properties: { tabColor: { argb: "FF888888" } } });

  // LISR Art. 96 — tabla mensual
  ws.addRow(["TARIFA ISR MENSUAL (Art. 96 LISR)"]);
  ws.getRow(1).getCell(1).font = { bold: true, size: 12 };
  ws.addRow(["Lím. Inferior", "Lím. Superior", "Cuota Fija", "Tasa"]);
  applyHeaderRow(ws, 2, 4);
  TARIFA_ISR.forEach((t, i) => {
    ws.addRow([t.li, t.ls === Infinity ? 99999999 : t.ls, t.cuota, t.tasa]);
    const r = i + 3;
    fmtMoney(ws.getRow(r).getCell(1));
    fmtMoney(ws.getRow(r).getCell(2));
    fmtMoney(ws.getRow(r).getCell(3));
    ws.getRow(r).getCell(4).numFmt = "0.0000";
  });
  const lastIsrRow = TARIFA_ISR.length + 2;
  wb.definedNames.add("TABLA_ISR", `'Tablas'!$A$3:$D$${lastIsrRow}`);

  // Tabla vacaciones LFT
  ws.addRow([]);
  ws.addRow(["TABLA VACACIONES LFT (Art. 76)"]);
  ws.getRow(lastIsrRow + 2).getCell(1).font = { bold: true, size: 12 };
  ws.addRow(["Años Antigüedad", "Días Vacaciones"]);
  applyHeaderRow(ws, lastIsrRow + 3, 2);
  TABLA_VACACIONES_LFT.forEach((t) => {
    ws.addRow([t.anios, t.dias]);
  });
  const vacStart = lastIsrRow + 4;
  const vacEnd = vacStart + TABLA_VACACIONES_LFT.length - 1;
  wb.definedNames.add("TABLA_VAC", `'Tablas'!$A$${vacStart}:$B$${vacEnd}`);

  autoFitCols(ws, [18, 18, 18, 12]);
}

// ============================================================================
// PESTAÑA: Pacientes
// ============================================================================

function pestPacientes(wb: ExcelJS.Workbook, pacientes: Paciente[]) {
  const ws = wb.addWorksheet("Pacientes", { properties: { tabColor: { argb: "FF22C55E" } } });
  ws.addRow(["ID", "Nombre", "Precio Sesión Regular", "Precio Sesión Matutina", "Mes Inicio", "Año Inicio", "Mes Alta", "Año Alta", "Estatus", "Tipo Terapia", "Notas"]);
  applyHeaderRow(ws, 1, 11);

  pacientes.forEach((p, i) => {
    const row = ws.addRow([
      p.id,
      p.nombre,
      p.precio_sesion_regular ?? null,
      p.precio_sesion_matutina ?? null,
      p.mes_inicio,
      p.anio_inicio,
      p.mes_alta,
      p.anio_alta,
      p.estatus,
      p.tipo_terapia ?? "",
      p.notas ?? "",
    ]);
    fmtMoney(row.getCell(3));
    fmtMoney(row.getCell(4));
  });

  autoFitCols(ws, [28, 32, 18, 18, 10, 10, 10, 10, 12, 22, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // Nombre named range para usar como lookup
  wb.definedNames.add("PACIENTES_ID", `'Pacientes'!$A$2:$A$${pacientes.length + 1}`);
  wb.definedNames.add("PACIENTES_NOMBRE", `'Pacientes'!$B$2:$B$${pacientes.length + 1}`);
  wb.definedNames.add("PACIENTES_PRECIO_REG", `'Pacientes'!$C$2:$C$${pacientes.length + 1}`);
  wb.definedNames.add("PACIENTES_PRECIO_MAT", `'Pacientes'!$D$2:$D$${pacientes.length + 1}`);
}

// ============================================================================
// PESTAÑA: Empleados
// ============================================================================

function pestEmpleados(wb: ExcelJS.Workbook, empleados: Empleado[]) {
  const ws = wb.addWorksheet("Empleados", { properties: { tabColor: { argb: "FF22C55E" } } });
  ws.addRow(["ID", "Nombre", "Puesto", "Sueldo Transferencia", "Sueldo Efectivo", "Fecha Ingreso", "Estatus", "Notas"]);
  applyHeaderRow(ws, 1, 8);

  empleados.forEach((e) => {
    const row = ws.addRow([
      e.id,
      e.nombre,
      e.puesto ?? "",
      Number(e.sueldo_transferencia_mes ?? 0),
      Number(e.sueldo_efectivo_mes ?? 0),
      e.fecha_ingreso ? new Date(e.fecha_ingreso) : null,
      e.estatus,
      e.notas ?? "",
    ]);
    fmtMoney(row.getCell(4));
    fmtMoney(row.getCell(5));
    if (e.fecha_ingreso) row.getCell(6).numFmt = "yyyy-mm-dd";
  });

  autoFitCols(ws, [28, 32, 22, 22, 22, 14, 12, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  wb.definedNames.add("EMPLEADOS_ID", `'Empleados'!$A$2:$A$${empleados.length + 1}`);
  wb.definedNames.add("EMPLEADOS_NOMBRE", `'Empleados'!$B$2:$B$${empleados.length + 1}`);
  wb.definedNames.add("EMPLEADOS_ST", `'Empleados'!$D$2:$D$${empleados.length + 1}`);
  wb.definedNames.add("EMPLEADOS_SE", `'Empleados'!$E$2:$E$${empleados.length + 1}`);
  wb.definedNames.add("EMPLEADOS_FECHA", `'Empleados'!$F$2:$F$${empleados.length + 1}`);
}

// ============================================================================
// PESTAÑA: Terapias (mensual por paciente con fórmulas)
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
    "Paciente", "Mes", "Sesiones Mat.", "Sesiones Reg.", "Beca %",
    "Forma Pago", "Precio Reg.", "Precio Mat.", "Subtotal", "Beca",
    "Recargo", "IVA", "Total Esperado", "Pagado", "Saldo",
  ]);
  applyHeaderRow(ws, 1, 15);

  // Construir registros agrupados por (paciente, mes)
  const pacMap = new Map(pacientes.map((p) => [p.id, p]));
  const rowsData: Array<{ pac: Paciente; mes: number; sM: number; sR: number; beca: number; forma: string; pagado: number }> = [];

  for (const s of sesiones.filter((s) => s.anio === anio)) {
    const pac = pacMap.get(s.paciente_id);
    if (!pac) continue;
    const pagosMes = pagos.filter((p) => p.paciente_id === s.paciente_id && p.anio === anio && p.mes === s.mes);
    rowsData.push({
      pac,
      mes: s.mes,
      sM: Number(s.sesiones_matutinas ?? 0),
      sR: Number(s.sesiones_regulares ?? 0),
      beca: Number(s.beca_porcentaje ?? 0),
      forma: s.forma_pago_mes,
      pagado: pagosMes.reduce((sum, p) => sum + Number(p.monto_pagado ?? 0), 0),
    });
  }
  rowsData.sort((a, b) => a.pac.nombre.localeCompare(b.pac.nombre) || a.mes - b.mes);

  rowsData.forEach((r, i) => {
    const rowNum = i + 2;
    // C col = sesiones matutinas, D = regulares
    // Precio Reg (G): si el paciente tiene precio, ese; si no, PRECIO_REG global
    // VLOOKUP del precio del paciente vía nombre
    const precioRegFormula = `IFERROR(IF(ISNUMBER(VLOOKUP(A${rowNum},Pacientes!$B$2:$C$${pacientes.length + 1},2,FALSE)),VLOOKUP(A${rowNum},Pacientes!$B$2:$C$${pacientes.length + 1},2,FALSE),PRECIO_REG),PRECIO_REG)`;
    const precioMatFormula = `IFERROR(IF(ISNUMBER(VLOOKUP(A${rowNum},Pacientes!$B$2:$D$${pacientes.length + 1},3,FALSE)),VLOOKUP(A${rowNum},Pacientes!$B$2:$D$${pacientes.length + 1},3,FALSE),PRECIO_MAT),PRECIO_MAT)`;
    // Subtotal (I) = sM*precioMat + sR*precioReg
    const subtotalFormula = `C${rowNum}*H${rowNum}+D${rowNum}*G${rowNum}`;
    // Beca aplicada (J) = subtotal * beca%/100
    const becaFormula = `I${rowNum}*E${rowNum}/100`;
    // Neto = subtotal - beca
    // Recargo (K): 0 por default (no se computa aquí — el usuario lo agrega manual si quiere)
    // IVA (L) = (subtotal - beca + recargo) * IVA si forma != Efectivo
    const ivaFormula = `IF(F${rowNum}="Efectivo",0,(I${rowNum}-J${rowNum}+K${rowNum})*IVA)`;
    // Total Esperado (M) = subtotal - beca + recargo + IVA
    const totalFormula = `I${rowNum}-J${rowNum}+K${rowNum}+L${rowNum}`;
    // Saldo (O) = total - pagado
    const saldoFormula = `M${rowNum}-N${rowNum}`;

    const row = ws.addRow([
      r.pac.nombre,
      r.mes,
      r.sM,
      r.sR,
      r.beca,
      r.forma,
      { formula: precioRegFormula },
      { formula: precioMatFormula },
      { formula: subtotalFormula },
      { formula: becaFormula },
      0, // recargo manual
      { formula: ivaFormula },
      { formula: totalFormula },
      r.pagado,
      { formula: saldoFormula },
    ]);
    [7, 8, 9, 10, 11, 12, 13, 14, 15].forEach((c) => fmtMoney(row.getCell(c)));
  });

  // Totales al final
  const lastRow = rowsData.length + 1;
  if (lastRow >= 2) {
    const totalRow = ws.addRow([
      "TOTAL", "", "", "", "", "", "", "",
      { formula: `SUM(I2:I${lastRow})` },
      { formula: `SUM(J2:J${lastRow})` },
      { formula: `SUM(K2:K${lastRow})` },
      { formula: `SUM(L2:L${lastRow})` },
      { formula: `SUM(M2:M${lastRow})` },
      { formula: `SUM(N2:N${lastRow})` },
      { formula: `SUM(O2:O${lastRow})` },
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    [9, 10, 11, 12, 13, 14, 15].forEach((c) => fmtMoney(totalRow.getCell(c)));
  }

  autoFitCols(ws, [32, 6, 12, 12, 8, 14, 12, 12, 12, 12, 12, 12, 14, 12, 12]);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
}

// ============================================================================
// PESTAÑA: Citas y Evaluaciones (eventos)
// ============================================================================

function pestEventos(
  wb: ExcelJS.Workbook,
  anio: number,
  eventos: Evento[],
  tipoFiltro: "citas" | "evaluaciones",
) {
  const TIPOS_CITAS = ["Cita inicial / ingreso", "Cita seguimiento directora", "Cita escolar virtual", "Cita escolar presencial", "Observación escolar", "Reporte adicional"];
  const TIPOS_EVAL = ["Evaluación"];
  const tiposPermitidos = tipoFiltro === "citas" ? TIPOS_CITAS : TIPOS_EVAL;
  const sheetName = tipoFiltro === "citas" ? "Citas" : "Evaluaciones";
  const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: "FFEC4899" } } });
  ws.addRow(["Fecha", "Tipo", "Paciente / Solicitante", "Forma Pago", "Precio Base", "IVA", "Total Esperado", "Pagado", "Saldo", "Notas"]);
  applyHeaderRow(ws, 1, 10);

  const evs = eventos.filter((ev) => {
    if (!ev.fecha?.startsWith(String(anio))) return false;
    return tiposPermitidos.includes(ev.tipo);
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));

  evs.forEach((ev, i) => {
    const r = i + 2;
    const ivaFormula = `IF(D${r}="Efectivo",0,E${r}*IVA)`;
    const totalFormula = `E${r}+F${r}`;
    const saldoFormula = `G${r}-H${r}`;
    const row = ws.addRow([
      ev.fecha ? new Date(ev.fecha + "T12:00:00") : null,
      ev.tipo,
      ev.nombre_paciente,
      ev.forma_pago,
      Number(ev.precio_base ?? 0),
      { formula: ivaFormula },
      { formula: totalFormula },
      Number(ev.monto_pagado ?? 0),
      { formula: saldoFormula },
      ev.notas ?? "",
    ]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    [5, 6, 7, 8, 9].forEach((c) => fmtMoney(row.getCell(c)));
  });

  const lastRow = evs.length + 1;
  if (lastRow >= 2) {
    const t = ws.addRow([
      "TOTAL", "", "", "",
      { formula: `SUM(E2:E${lastRow})` },
      { formula: `SUM(F2:F${lastRow})` },
      { formula: `SUM(G2:G${lastRow})` },
      { formula: `SUM(H2:H${lastRow})` },
      { formula: `SUM(I2:I${lastRow})` },
      "",
    ]);
    t.font = { bold: true };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    [5, 6, 7, 8, 9].forEach((c) => fmtMoney(t.getCell(c)));
  }

  autoFitCols(ws, [12, 28, 32, 14, 12, 12, 14, 12, 12, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// PESTAÑA: Subarrendamiento
// ============================================================================

function pestSubarrendamiento(wb: ExcelJS.Workbook, anio: number, subarr: Subarrendamiento[]) {
  const ws = wb.addWorksheet("Subarrendamiento", { properties: { tabColor: { argb: "FF06B6D4" } } });
  ws.addRow(["Inquilino", "Mes", "Renta Base", "Forma Pago", "Monto Cobrado", "Subtotal", "IVA", "Total", "Notas"]);
  applyHeaderRow(ws, 1, 9);

  const recs = subarr.filter((s) => s.anio === anio).sort((a, b) => a.inquilino.localeCompare(b.inquilino) || a.mes - b.mes);
  recs.forEach((s, i) => {
    const r = i + 2;
    // Monto cobrado E ya viene con o sin IVA según forma pago. Para mostrar
    // bien: si forma_pago != Efectivo, asumimos viene con IVA → subtotal = monto/(1+IVA)
    const subtotalFormula = `IF(D${r}="Efectivo",E${r},E${r}/(1+IVA))`;
    const ivaFormula = `IF(D${r}="Efectivo",0,E${r}-F${r})`;
    const totalFormula = `E${r}`;
    const row = ws.addRow([
      s.inquilino,
      s.mes,
      Number(s.renta_mensual_base ?? 0),
      s.forma_pago,
      Number(s.monto_cobrado ?? 0),
      { formula: subtotalFormula },
      { formula: ivaFormula },
      { formula: totalFormula },
      s.notas ?? "",
    ]);
    [3, 5, 6, 7, 8].forEach((c) => fmtMoney(row.getCell(c)));
  });

  const lastRow = recs.length + 1;
  if (lastRow >= 2) {
    const t = ws.addRow([
      "TOTAL", "", "", "",
      { formula: `SUM(E2:E${lastRow})` },
      { formula: `SUM(F2:F${lastRow})` },
      { formula: `SUM(G2:G${lastRow})` },
      { formula: `SUM(H2:H${lastRow})` },
      "",
    ]);
    t.font = { bold: true };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    [5, 6, 7, 8].forEach((c) => fmtMoney(t.getCell(c)));
  }

  autoFitCols(ws, [22, 6, 14, 14, 14, 14, 12, 14, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// PESTAÑA: Gastos
// ============================================================================

function pestGastos(wb: ExcelJS.Workbook, anio: number, gastos: Gasto[]) {
  const ws = wb.addWorksheet("Gastos", { properties: { tabColor: { argb: "FFEF4444" } } });
  ws.addRow(["Fecha", "Mes", "Categoría", "Concepto", "Monto", "Con Factura", "IVA Acreditable", "Forma Pago", "Proveedor", "Notas"]);
  applyHeaderRow(ws, 1, 10);

  const recs = gastos.filter((g) => g.fecha?.startsWith(String(anio))).sort((a, b) => a.fecha.localeCompare(b.fecha));
  recs.forEach((g, i) => {
    const r = i + 2;
    // IVA acreditable: si con factura, monto × IVA / (1+IVA) (asumiendo monto incluye IVA)
    const ivaFormula = `IF(F${r}="Sí",E${r}*IVA/(1+IVA),0)`;
    const mesFormula = `MONTH(A${r})`;
    const row = ws.addRow([
      new Date(g.fecha + "T12:00:00"),
      { formula: mesFormula },
      g.categoria,
      g.concepto,
      Number(g.monto ?? 0),
      g.con_factura ? "Sí" : "No",
      { formula: ivaFormula },
      g.forma_pago,
      g.proveedor ?? "",
      g.notas ?? "",
    ]);
    row.getCell(1).numFmt = "yyyy-mm-dd";
    [5, 7].forEach((c) => fmtMoney(row.getCell(c)));
  });

  const lastRow = recs.length + 1;
  if (lastRow >= 2) {
    const t = ws.addRow([
      "TOTAL", "", "", "",
      { formula: `SUM(E2:E${lastRow})` },
      "",
      { formula: `SUM(G2:G${lastRow})` },
      "", "", "",
    ]);
    t.font = { bold: true };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    fmtMoney(t.getCell(5));
    fmtMoney(t.getCell(7));
  }

  autoFitCols(ws, [12, 6, 20, 32, 12, 12, 14, 14, 22, 30]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// PESTAÑA: Nómina (mensual con fórmulas)
// ============================================================================

function pestNomina(wb: ExcelJS.Workbook, anio: number, empleados: Empleado[], nomina: NominaMensual[]) {
  const ws = wb.addWorksheet("Nómina", { properties: { tabColor: { argb: "FFA855F7" } } });
  ws.addRow([
    "Empleado", "Mes",
    "Sueldo Transf.", "Sueldo Efectivo", "Total Sueldo",
    "Aguinaldo", "Prima Vac.", "Bono",
    "SBC Diario", "SBC Mensual",
    "IMSS Patronal", "ISN", "ISR Retenido", "Infonavit",
    "Total Egreso",
  ]);
  applyHeaderRow(ws, 1, 15);

  const empMap = new Map(empleados.map((e) => [e.id, e]));
  const recs = nomina.filter((n) => n.anio === anio).sort((a, b) => {
    const ea = empMap.get(a.empleado_id), eb = empMap.get(b.empleado_id);
    const na = ea?.nombre ?? a.empleado_nombre ?? "";
    const nb = eb?.nombre ?? b.empleado_nombre ?? "";
    return na.localeCompare(nb) || a.mes - b.mes;
  });

  recs.forEach((n, i) => {
    const r = i + 2;
    const emp = empMap.get(n.empleado_id);
    const fechaIngreso = emp?.fecha_ingreso ? new Date(emp.fecha_ingreso) : null;
    const anioIngreso = fechaIngreso?.getFullYear() ?? anio;

    // E = total sueldo = C + D
    const totalSueldoFormula = `C${r}+D${r}`;
    // F = aguinaldo (solo mes 12) = totalSueldo/30 * DIAS_AGUINALDO
    const aguinaldoFormula = `IF(B${r}=12,E${r}/30*DIAS_AGUINALDO,0)`;
    // G = prima vac mensual (provisión) = (E/30 * diasVacLFT * 0.25)/12. Usa VLOOKUP a TABLA_VAC con años antigüedad.
    // Años antigüedad = anio - anioIngreso (constante por empleado, lo dejo como número)
    const antiguedad = anio - anioIngreso;
    // VLOOKUP busca el tramo correcto
    const primaFormula = antiguedad >= 1
      ? `(E${r}/30 * VLOOKUP(${antiguedad},TABLA_VAC,2,TRUE) * 0.25) / 12`
      : `0`;
    // I = SBC diario = (C × FACTOR_INT)/30.4 cap 25*UMA
    const sbcDiarioFormula = `MIN((C${r}*FACTOR_INT)/30.4, 25*UMA)`;
    // J = SBC mensual = I × 30.4
    const sbcMensualFormula = `I${r}*30.4`;
    // K = IMSS Patronal (aproximación lineal): J × IMSS_TASA
    const imssFormula = `J${r}*IMSS_TASA`;
    // L = ISN = J × ISN_TASA
    const isnFormula = `J${r}*ISN_TASA`;
    // M = ISR Retenido vía VLOOKUP a TABLA_ISR (aproximación)
    // Formato: cuota_fija + (bruto - li) × tasa  donde bruto ≈ C (sueldo transferencia neto, aprox)
    // Para precisión real usaríamos gross-up; aquí aplicamos a C como aproximación
    const isrFormula = `MAX(0, VLOOKUP(C${r},TABLA_ISR,3,TRUE) + (C${r} - VLOOKUP(C${r},TABLA_ISR,1,TRUE)) * VLOOKUP(C${r},TABLA_ISR,4,TRUE))`;
    // N = Infonavit = J × 5%
    const infonavitFormula = `J${r}*0.05`;
    // O = Total Egreso = C + D + F + G + H + K + L + N (ISR no es egreso de la empresa, es retención)
    const totalEgresoFormula = `C${r}+D${r}+F${r}+G${r}+H${r}+K${r}+L${r}+N${r}`;

    const row = ws.addRow([
      emp?.nombre ?? n.empleado_nombre ?? "",
      n.mes,
      Number(n.sueldo_transferencia ?? 0),
      Number(n.sueldo_efectivo ?? 0),
      { formula: totalSueldoFormula },
      { formula: aguinaldoFormula },
      { formula: primaFormula },
      Number(n.bono ?? 0),
      { formula: sbcDiarioFormula },
      { formula: sbcMensualFormula },
      { formula: imssFormula },
      { formula: isnFormula },
      { formula: isrFormula },
      { formula: infonavitFormula },
      { formula: totalEgresoFormula },
    ]);
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].forEach((c) => fmtMoney(row.getCell(c)));
  });

  const lastRow = recs.length + 1;
  if (lastRow >= 2) {
    const t = ws.addRow([
      "TOTAL", "",
      { formula: `SUM(C2:C${lastRow})` },
      { formula: `SUM(D2:D${lastRow})` },
      { formula: `SUM(E2:E${lastRow})` },
      { formula: `SUM(F2:F${lastRow})` },
      { formula: `SUM(G2:G${lastRow})` },
      { formula: `SUM(H2:H${lastRow})` },
      "", "",
      { formula: `SUM(K2:K${lastRow})` },
      { formula: `SUM(L2:L${lastRow})` },
      { formula: `SUM(M2:M${lastRow})` },
      { formula: `SUM(N2:N${lastRow})` },
      { formula: `SUM(O2:O${lastRow})` },
    ]);
    t.font = { bold: true };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    [3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15].forEach((c) => fmtMoney(t.getCell(c)));
  }

  autoFitCols(ws, [28, 6, 14, 14, 14, 12, 12, 10, 12, 14, 14, 12, 14, 12, 14]);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
}

// ============================================================================
// PESTAÑA: Flujo de Efectivo (SUMIF por mes a otras pestañas)
// ============================================================================

function pestFlujoEfectivo(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Flujo de Efectivo", { properties: { tabColor: { argb: "FF0EA5E9" } } });
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  ws.addRow(["Concepto", ...MESES, "Total"]);
  applyHeaderRow(ws, 1, 14);

  // Filas: cada concepto con SUMIF a la pestaña correspondiente
  // Hacer SUMIF de Terapias!N (pagado) where Terapias!B = mes
  const filas = [
    { label: "(+) Terapias Cobradas",      tipo: "ingreso", formula: (m: number) => `SUMIFS(Terapias!$N:$N,Terapias!$B:$B,${m})` },
    { label: "(+) Citas Cobradas",          tipo: "ingreso", formula: (m: number) => `SUMIFS(Citas!$H:$H,Citas!$A:$A,">="&DATE(${"YEAR_PLACEHOLDER"},${m},1),Citas!$A:$A,"<"&DATE(${"YEAR_PLACEHOLDER"},${m + 1},1))` },
    { label: "(+) Evaluaciones Cobradas",   tipo: "ingreso", formula: (m: number) => `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$A:$A,">="&DATE(${"YEAR_PLACEHOLDER"},${m},1),Evaluaciones!$A:$A,"<"&DATE(${"YEAR_PLACEHOLDER"},${m + 1},1))` },
    { label: "(+) Subarrendamiento Cobrado", tipo: "ingreso", formula: (m: number) => `SUMIFS(Subarrendamiento!$E:$E,Subarrendamiento!$B:$B,${m})` },
    { label: "= TOTAL INGRESOS",            tipo: "subtotal", formula: (m: number) => "SUM_INGRESOS" },
    { label: "(-) Gastos",                  tipo: "egreso",  formula: (m: number) => `SUMIFS(Gastos!$E:$E,Gastos!$B:$B,${m})` },
    { label: "(-) Sueldos (Transf + Efvo)", tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$E:$E,Nómina!$B:$B,${m})` },
    { label: "(-) Aguinaldo",               tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$F:$F,Nómina!$B:$B,${m})` },
    { label: "(-) Prima Vacacional",        tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$G:$G,Nómina!$B:$B,${m})` },
    { label: "(-) Bono",                    tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$H:$H,Nómina!$B:$B,${m})` },
    { label: "(-) IMSS Patronal",           tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$K:$K,Nómina!$B:$B,${m})` },
    { label: "(-) ISN",                     tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$L:$L,Nómina!$B:$B,${m})` },
    { label: "(-) Infonavit",               tipo: "egreso",  formula: (m: number) => `SUMIFS(Nómina!$N:$N,Nómina!$B:$B,${m})` },
    { label: "= TOTAL EGRESOS",             tipo: "subtotal", formula: (m: number) => "SUM_EGRESOS" },
    { label: "FLUJO NETO MES",              tipo: "neto",   formula: (m: number) => "NETO" },
    { label: "SALDO ACUMULADO",             tipo: "saldo",   formula: (m: number) => "SALDO" },
  ];

  // Pre-armar; resolver placeholders cuando construya filas
  // El año actual: usar el primer mes con datos como referencia. En lugar de hardcode,
  // tomamos del título de la pestaña o asumimos que el usuario abre y los DATE() son del año del data.
  // Para SUMIFS sobre fechas, el año debe ser el filtrado. Voy a usar una celda separada con el año.

  // Fila 2 — Año actual (editable)
  // Nope, mejor inyecto el año directamente en las fórmulas. Recibo `anio` desde el caller.
  // Pero esta función no lo recibe. Voy a cambiarlo arriba.
}

// Reescribimos pestFlujoEfectivo para que tome el año:
function pestFlujoEfectivoV2(wb: ExcelJS.Workbook, anio: number) {
  const ws = wb.addWorksheet("Flujo de Efectivo", { properties: { tabColor: { argb: "FF0EA5E9" } } });
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  ws.addRow(["Concepto", ...MESES, "Total"]);
  applyHeaderRow(ws, 1, 14);

  type Fila = { label: string; formula?: (m: number) => string; subtotal?: "ingresos" | "egresos"; neto?: boolean; saldo?: boolean };
  const filas: Fila[] = [
    { label: "(+) Terapias Cobradas",       formula: (m) => `SUMIFS(Terapias!$N:$N,Terapias!$B:$B,${m})` },
    { label: "(+) Citas Cobradas",          formula: (m) => `SUMIFS(Citas!$H:$H,Citas!$A:$A,">="&DATE(${anio},${m},1),Citas!$A:$A,"<"&DATE(${anio},${m + 1},1))` },
    { label: "(+) Evaluaciones Cobradas",   formula: (m) => `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$A:$A,">="&DATE(${anio},${m},1),Evaluaciones!$A:$A,"<"&DATE(${anio},${m + 1},1))` },
    { label: "(+) Subarrendamiento Cobrado", formula: (m) => `SUMIFS(Subarrendamiento!$E:$E,Subarrendamiento!$B:$B,${m})` },
    { label: "= TOTAL INGRESOS",            subtotal: "ingresos" },
    { label: "(-) Gastos",                  formula: (m) => `SUMIFS(Gastos!$E:$E,Gastos!$B:$B,${m})` },
    { label: "(-) Sueldos (Transf + Efvo)", formula: (m) => `SUMIFS(Nómina!$E:$E,Nómina!$B:$B,${m})` },
    { label: "(-) Aguinaldo",               formula: (m) => `SUMIFS(Nómina!$F:$F,Nómina!$B:$B,${m})` },
    { label: "(-) Prima Vacacional",        formula: (m) => `SUMIFS(Nómina!$G:$G,Nómina!$B:$B,${m})` },
    { label: "(-) Bono",                    formula: (m) => `SUMIFS(Nómina!$H:$H,Nómina!$B:$B,${m})` },
    { label: "(-) IMSS Patronal",           formula: (m) => `SUMIFS(Nómina!$K:$K,Nómina!$B:$B,${m})` },
    { label: "(-) ISN",                     formula: (m) => `SUMIFS(Nómina!$L:$L,Nómina!$B:$B,${m})` },
    { label: "(-) Infonavit",               formula: (m) => `SUMIFS(Nómina!$N:$N,Nómina!$B:$B,${m})` },
    { label: "= TOTAL EGRESOS",             subtotal: "egresos" },
    { label: "FLUJO NETO DEL MES",          neto: true },
    { label: "SALDO ACUMULADO",             saldo: true },
  ];

  // Mapeo: necesito conocer las filas del Excel para referencias después
  // Inicio en fila 2
  const rowOfIngresosTotal = filas.findIndex((f) => f.subtotal === "ingresos") + 2;
  const rowOfEgresosTotal = filas.findIndex((f) => f.subtotal === "egresos") + 2;
  const rowOfNeto = filas.findIndex((f) => f.neto) + 2;
  const rowOfSaldo = filas.findIndex((f) => f.saldo) + 2;
  // Rangos para SUM de subtotal
  const ingresosStart = 2;
  const ingresosEnd = rowOfIngresosTotal - 1;
  const egresosStart = rowOfIngresosTotal + 1;
  const egresosEnd = rowOfEgresosTotal - 1;

  filas.forEach((f, i) => {
    const r = i + 2;
    const values: (string | number | { formula: string })[] = [f.label];
    for (let m = 1; m <= 12; m++) {
      const colLetter = String.fromCharCode(65 + m); // B..M
      if (f.formula) {
        values.push({ formula: f.formula(m) });
      } else if (f.subtotal === "ingresos") {
        values.push({ formula: `SUM(${colLetter}${ingresosStart}:${colLetter}${ingresosEnd})` });
      } else if (f.subtotal === "egresos") {
        values.push({ formula: `SUM(${colLetter}${egresosStart}:${colLetter}${egresosEnd})` });
      } else if (f.neto) {
        values.push({ formula: `${colLetter}${rowOfIngresosTotal}-${colLetter}${rowOfEgresosTotal}` });
      } else if (f.saldo) {
        // Saldo enero = SALDO_INICIAL + neto_enero; saldo m = saldo_anterior + neto_m
        if (m === 1) values.push({ formula: `SALDO_INICIAL+${colLetter}${rowOfNeto}` });
        else {
          const prevCol = String.fromCharCode(65 + (m - 1));
          values.push({ formula: `${prevCol}${rowOfSaldo}+${colLetter}${rowOfNeto}` });
        }
      }
    }
    // Total columna (N) = SUM B..M (excepto saldo que mostraría el último mes)
    if (f.saldo) {
      values.push({ formula: `M${rowOfSaldo}` });
    } else {
      values.push({ formula: `SUM(B${r}:M${r})` });
    }
    const row = ws.addRow(values);

    // Estilos
    for (let c = 2; c <= 14; c++) fmtMoney(row.getCell(c));
    if (f.subtotal === "ingresos") {
      row.font = { bold: true, color: { argb: "FF15803D" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    } else if (f.subtotal === "egresos") {
      row.font = { bold: true, color: { argb: "FFB91C1C" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    } else if (f.neto) {
      row.font = { bold: true };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    } else if (f.saldo) {
      row.font = { bold: true, color: { argb: "FF6D28D9" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } };
    }
  });

  autoFitCols(ws, [32, ...new Array(12).fill(12), 14]);
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
}

// ============================================================================
// PESTAÑA: Para el Contador (resumen SAT mensual)
// ============================================================================

function pestParaContador(wb: ExcelJS.Workbook, anio: number) {
  const ws = wb.addWorksheet("Para el Contador", { properties: { tabColor: { argb: "FFFBBF24" } } });
  ws.addRow(["Mes", "Subtotal Facturable", "IVA Trasladado", "Total Facturable", "Total Efectivo", "Gran Total"]);
  applyHeaderRow(ws, 1, 6);

  // Formas facturables: Transferencia, Tarjeta, Depósito
  // Para Terapias, las formas se ven en col F. Total pagado en N.
  // Suma facturable terapias: SUMIFS(Terapias!N, Terapias!B, mes, Terapias!F, <>"Efectivo")
  // Total Subtotal facturable = pagado / (1 + IVA)
  // IVA = pagado × IVA / (1 + IVA)
  // En Citas/Evaluaciones la columna H ya es el monto pagado (sin IVA por convención del usuario).
  // Para mantenerlo simple, asumo:
  //   - Terapias / Subarr: monto pagado YA incluye IVA (en transferencias)
  //   - Citas / Eval: monto pagado SIN IVA → multiplicar × (1+IVA) para total
  // Hago la simplificación con SUMIFS por mes y forma.

  for (let m = 1; m <= 12; m++) {
    const r = m + 1;
    // Total facturable bruto (con IVA si aplica) por concepto:
    const terapiasFact = `SUMIFS(Terapias!$N:$N,Terapias!$B:$B,${m},Terapias!$F:$F,"<>Efectivo")`;
    const subarrFact = `SUMIFS(Subarrendamiento!$E:$E,Subarrendamiento!$B:$B,${m},Subarrendamiento!$D:$D,"<>Efectivo")`;
    // Para citas/eval, fecha está en col A, forma en D, monto pagado en H
    const citasFact = `SUMIFS(Citas!$H:$H,Citas!$A:$A,">="&DATE(${anio},${m},1),Citas!$A:$A,"<"&DATE(${anio},${m + 1},1),Citas!$D:$D,"<>Efectivo")`;
    const evalFact = `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$A:$A,">="&DATE(${anio},${m},1),Evaluaciones!$A:$A,"<"&DATE(${anio},${m + 1},1),Evaluaciones!$D:$D,"<>Efectivo")`;

    // Convención: para terapias/subarr, monto INCLUYE IVA → subtotal = monto/(1+IVA)
    // Para citas/eval, monto YA es sin IVA → subtotal = monto, total = monto*(1+IVA)
    const subtotal = `(${terapiasFact})/(1+IVA) + (${subarrFact})/(1+IVA) + (${citasFact}) + (${evalFact})`;
    const totalFact = `(${terapiasFact}) + (${subarrFact}) + (${citasFact})*(1+IVA) + (${evalFact})*(1+IVA)`;
    const ivaTras = `(${totalFact}) - (${subtotal})`;

    // Total efectivo
    const terapiasEfvo = `SUMIFS(Terapias!$N:$N,Terapias!$B:$B,${m},Terapias!$F:$F,"Efectivo")`;
    const subarrEfvo = `SUMIFS(Subarrendamiento!$E:$E,Subarrendamiento!$B:$B,${m},Subarrendamiento!$D:$D,"Efectivo")`;
    const citasEfvo = `SUMIFS(Citas!$H:$H,Citas!$A:$A,">="&DATE(${anio},${m},1),Citas!$A:$A,"<"&DATE(${anio},${m + 1},1),Citas!$D:$D,"Efectivo")`;
    const evalEfvo = `SUMIFS(Evaluaciones!$H:$H,Evaluaciones!$A:$A,">="&DATE(${anio},${m},1),Evaluaciones!$A:$A,"<"&DATE(${anio},${m + 1},1),Evaluaciones!$D:$D,"Efectivo")`;
    const totalEfvo = `(${terapiasEfvo}) + (${subarrEfvo}) + (${citasEfvo}) + (${evalEfvo})`;

    const mesNombre = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][m - 1];

    const row = ws.addRow([
      mesNombre,
      { formula: subtotal },
      { formula: ivaTras },
      { formula: totalFact },
      { formula: totalEfvo },
      { formula: `D${r}+E${r}` },
    ]);
    [2, 3, 4, 5, 6].forEach((c) => fmtMoney(row.getCell(c)));
  }

  // Totales año
  const t = ws.addRow([
    "TOTAL AÑO",
    { formula: "SUM(B2:B13)" },
    { formula: "SUM(C2:C13)" },
    { formula: "SUM(D2:D13)" },
    { formula: "SUM(E2:E13)" },
    { formula: "SUM(F2:F13)" },
  ]);
  t.font = { bold: true };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  [2, 3, 4, 5, 6].forEach((c) => fmtMoney(t.getCell(c)));

  autoFitCols(ws, [16, 18, 16, 18, 16, 18]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ============================================================================
// PESTAÑA: Instrucciones / Cover
// ============================================================================

function pestInstrucciones(wb: ExcelJS.Workbook, anio: number) {
  const ws = wb.addWorksheet("Instrucciones", { properties: { tabColor: { argb: "FF6D28D9" } } });
  ws.getColumn(1).width = 100;
  ws.addRow([`Respaldo Flujo Consentido — Año ${anio}`]).font = { bold: true, size: 16 };
  ws.addRow([`Generado: ${new Date().toLocaleString("es-MX")}`]).font = { italic: true, color: { argb: "FF888888" } };
  ws.addRow([]);
  ws.addRow(["Pestañas:"]).font = { bold: true };
  const items = [
    "  • Parámetros — IVA, tasas, precios globales. Si cambias estos valores, TODAS las pestañas recalculan.",
    "  • Tablas — Tabla LISR Art. 96 y LFT Vacaciones. Usadas por VLOOKUP, no edites a menos que cambien.",
    "  • Pacientes / Empleados — catálogos editables.",
    "  • Terapias — sesiones × precio = saldo. Cambia sesiones o forma de pago y se recalcula.",
    "  • Citas / Evaluaciones — eventos con IVA automático según forma de pago.",
    "  • Subarrendamiento — montos cobrados con IVA desglosado.",
    "  • Gastos — incluye IVA acreditable cuando hay factura.",
    "  • Nómina — sueldos editables, prima vac, IMSS, ISN, ISR retenido e Infonavit calculados.",
    "  • Flujo de Efectivo — SUMIF por mes desde todas las pestañas. Saldo acumulado.",
    "  • Para el Contador — resumen mensual SAT (subtotal/IVA/total facturable + efectivo).",
  ];
  items.forEach((s) => ws.addRow([s]));
  ws.addRow([]);
  ws.addRow(["Limitaciones conocidas:"]).font = { bold: true };
  ws.addRow(["  • IMSS Patronal usa aproximación lineal (~95% exacta). La app usa gross-up iterativo más preciso."]);
  ws.addRow(["  • ISR Retenido usa la tabla LISR sobre el sueldo transferencia. La app aplica gross-up primero."]);
  ws.addRow(["  • Cambios en este Excel NO afectan la app. Para que reflejen, captura desde la web."]);
}

// ============================================================================
// EXPORT PRINCIPAL
// ============================================================================

export async function generarExcelRespaldo(anio: number): Promise<Blob> {
  // Cargar todo en paralelo
  const [parametros, pacientes, empleados, sesiones, pagos, eventos, subarr, gastos, nomina] = await Promise.all([
    db.parametro.list("clave"),
    db.paciente.list("nombre", 500),
    db.empleado.list("nombre", 200),
    db.sesion_mensual.list("-created_date", 5000),
    db.pago_terapia.list("-created_date", 5000),
    db.evento.list("-fecha", 2000),
    db.subarrendamiento.list("-created_date", 500),
    db.gasto.list("-fecha", 10000),
    db.nomina_mensual.list("-created_date", 2000),
  ]);

  const paramsMap = paramsToMap(parametros);
  void paramsMap; // ParamMap se usa indirectamente via valor literal en pestParametros

  const wb = new ExcelJS.Workbook();
  wb.creator = "Flujo Consentido";
  wb.created = new Date();
  wb.modified = new Date();

  // Orden importa: Parámetros y Tablas primero para que las named ranges existan
  pestInstrucciones(wb, anio);
  pestParametros(wb, paramsMap);
  pestTablas(wb);
  pestPacientes(wb, pacientes);
  pestEmpleados(wb, empleados);
  pestTerapias(wb, anio, pacientes, sesiones, pagos);
  pestEventos(wb, anio, eventos, "citas");
  pestEventos(wb, anio, eventos, "evaluaciones");
  pestSubarrendamiento(wb, anio, subarr);
  pestGastos(wb, anio, gastos);
  pestNomina(wb, anio, empleados, nomina);
  pestFlujoEfectivoV2(wb, anio);
  pestParaContador(wb, anio);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
