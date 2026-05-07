"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Search, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import {
  generarCalendario, paramsToObject, fmtMXN, estatusCxC, MESES, pacienteAplicaEnMes,
  type ParamMap, type EstatusCxC,
} from "@/lib/calculos";
import type { CalendarioPaciente, FormaPago, Paciente, PagoTerapia } from "@/types/db";

const FORMAS_PAGO: FormaPago[] = ["Efectivo", "Transferencia", "Tarjeta", "Depósito"];
const DIAS_KEY = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
const CON_IVA_FORMAS: FormaPago[] = ["Transferencia", "Tarjeta", "Depósito"];

interface EditState {
  monto: number;
  forma: FormaPago;
  sesiones: number | null;
  recargo: boolean;
}

interface CobranzaRow {
  paciente_id: string;
  nombre: string;
  tieneCal: boolean;
  totalSesiones: number | null;
  montoEfectivo: number | null;
  totalEsperado: number | null;
  montoPagado: number;
  pagadoConIva: number | null;
  saldo: number | null;
  saldoAFavor: number;
  estatus: EstatusCxC;
}

function calcularSesionesDesdeCal(
  cal: { anio: number; mes: number; horario: Record<string, string>; excepciones?: string | null; reposiciones?: any[]; total_sesiones?: number; monto_efectivo?: number },
  params: ParamMap,
  paciente?: Paciente | null,
) {
  // Precio LIVE: paciente.precio_sesion_regular si está definido, sino global.
  // Recalcular live (en vez de usar cal.monto_efectivo guardado) permite que
  // un cambio en el precio del paciente refleje sin re-guardar cada calendario.
  const precioGlobal = Number(params.precio_terapia_regular ?? 1100);
  const precioPorSesion = Number(paciente?.precio_sesion_regular) || precioGlobal;

  // Conteo de sesiones: trust the saved cal.total_sesiones (aplica asuetos
  // y reposiciones correctamente). Solo recompute si no hay valor guardado.
  const savedSes = Number(cal.total_sesiones) || 0;
  if (savedSes > 0) {
    return { totalSesiones: savedSes, montoEfectivo: savedSes * precioPorSesion };
  }
  const { celdas } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, cal.excepciones || "");
  const reposicionesValidas = (cal.reposiciones || []).filter((r: any) => r.dia && r.hora);
  let montoEfectivo = 0;
  let totalSesiones = 0;
  celdas.flat().forEach((c) => {
    if (c.tipo !== "sesion") return;
    totalSesiones++;
    montoEfectivo += precioPorSesion;
  });
  reposicionesValidas.forEach(() => {
    totalSesiones++;
    montoEfectivo += precioPorSesion;
  });
  return { totalSesiones, montoEfectivo };
}

export default function CobranzaPage() {
  const [params, setParams] = useState<ParamMap>({});
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth() + 1);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const [calendarios, setCalendarios] = useState<CalendarioPaciente[]>([]);
  const [pagosDB, setPagosDB] = useState<PagoTerapia[]>([]);
  const [saldosAFavor, setSaldosAFavor] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, EditState>>({});

  // Cargar params
  useEffect(() => {
    db.parametro.list("clave").then((p) => setParams(paramsToObject(p)));
  }, []);

  const cargarMes = useCallback(async () => {
    if (Object.keys(params).length === 0) return;
    try {
      const [cals, allPagos, allCals, allPacientes] = await Promise.all([
        db.calendario_paciente.filter({ mes: filtroMes, anio: filtroAnio }),
        db.pago_terapia.list("-created_date", 500),
        db.calendario_paciente.list("-created_date", 1000),
        db.paciente.filter({ estatus: "Activo" }, "nombre", 300),
      ]);
      setPacientes(allPacientes);

      const pagosMes = allPagos.filter((p) => p.mes === filtroMes && p.anio === filtroAnio);

      // Saldos a favor de meses anteriores
      const mesBaseInicio = { anio: 2026, mes: 5 };
      const filtroEsAnteriorABase = filtroAnio < mesBaseInicio.anio || (filtroAnio === mesBaseInicio.anio && filtroMes <= mesBaseInicio.mes);
      const pagosAnteriores = filtroEsAnteriorABase ? [] : allPagos.filter((p) => {
        const pAnio = p.anio || 2026;
        return pAnio < filtroAnio || (pAnio === filtroAnio && p.mes < filtroMes);
      });

      const saldos: Record<string, number> = {};
      const porPacMes: Record<string, { paciente_id: string; anio: number; mes: number; pagos: PagoTerapia[] }> = {};
      pagosAnteriores.forEach((p) => {
        const k = `${p.paciente_id}_${p.anio || 2026}_${p.mes}`;
        if (!porPacMes[k]) porPacMes[k] = { paciente_id: p.paciente_id, anio: p.anio || 2026, mes: p.mes, pagos: [] };
        porPacMes[k].pagos.push(p);
      });

      const ivaRateLocal = Number(params.iva ?? 0.16);
      const precioRegularLocal = Number(params.precio_terapia_regular ?? 1100);
      Object.values(porPacMes).forEach(({ paciente_id, anio, mes, pagos }) => {
        const montoPagadoTotal = pagos.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
        const forma = pagos[0]?.forma_pago || "Efectivo";
        const conIva = CON_IVA_FORMAS.includes(forma);
        const cal = allCals.find((c) => c.paciente_id === paciente_id && c.anio === anio && c.mes === mes);
        let totalEsperado: number | null = null;
        if (cal) {
          const pReg = Number(params.precio_terapia_regular ?? 1100);
          const pMat = Number(params.precio_terapia_matutina ?? 900);
          let monto = 0;
          const { celdas } = generarCalendario(anio, mes, cal.horario || {}, cal.excepciones || "");
          celdas.flat().forEach((c) => {
            if (c.tipo !== "sesion" || c.diaSemana === undefined) return;
            const tipo = cal.tipo_sesion?.[DIAS_KEY[c.diaSemana]] || "Regular";
            monto += tipo === "Matutina" ? pMat : pReg;
          });
          (cal.reposiciones || []).filter((r) => r.dia && r.hora).forEach((r) => {
            monto += r.tipoRep === "Matutina" ? pMat : pReg;
          });
          const recargoPago = pagos[0]?.recargo ? monto * 0.1 : 0;
          monto += recargoPago;
          totalEsperado = conIva ? Math.round(monto * (1 + ivaRateLocal)) : monto;
        } else if (pagos[0]?.sesiones_manual != null) {
          const ses = Number(pagos[0].sesiones_manual);
          const monto = ses * precioRegularLocal;
          totalEsperado = conIva ? Math.round(monto * (1 + ivaRateLocal)) : monto;
        }
        if (totalEsperado !== null) {
          const pagadoReal = conIva ? Math.round(montoPagadoTotal * (1 + ivaRateLocal)) : montoPagadoTotal;
          const dif = pagadoReal - totalEsperado;
          if (dif > 0) saldos[paciente_id] = (saldos[paciente_id] || 0) + dif;
        }
      });
      setSaldosAFavor(saldos);

      const calsValidas = cals.filter((cal) => {
        const pac = allPacientes.find((p) => p.id === cal.paciente_id);
        return pac && pacienteAplicaEnMes(pac, cal.mes, cal.anio);
      });
      setCalendarios(calsValidas);
      setPagosDB(pagosMes);

      // Inicializar edits
      const porPaciente: Record<string, PagoTerapia[]> = {};
      pagosMes.forEach((p) => {
        if (!porPaciente[p.paciente_id]) porPaciente[p.paciente_id] = [];
        porPaciente[p.paciente_id].push(p);
      });
      const nuevosEdits: Record<string, EditState> = {};
      Object.entries(porPaciente).forEach(([pid, lista]) => {
        nuevosEdits[pid] = {
          monto: lista.reduce((s, p) => s + Number(p.monto_pagado || 0), 0),
          forma: lista[0]?.forma_pago || "Efectivo",
          sesiones: lista.find((p) => p.sesiones_manual != null)?.sesiones_manual ?? null,
          recargo: lista[0]?.recargo || false,
        };
      });
      setEdits(nuevosEdits);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar cobranza");
    }
  }, [filtroMes, filtroAnio, params]);

  useEffect(() => {
    cargarMes();
  }, [cargarMes]);

  const ivaRate = Number(params.iva ?? 0.16);
  const precioRegular = Number(params.precio_terapia_regular ?? 1100);
  const recargoPct = Number(params.recargo_pago_tarde ?? 0.1);

  const hoy = new Date();
  const esMesActual = filtroAnio === hoy.getFullYear() && filtroMes === hoy.getMonth() + 1;
  const diaRef = esMesActual ? hoy.getDate() : (filtroAnio > hoy.getFullYear() || (filtroAnio === hoy.getFullYear() && filtroMes > hoy.getMonth() + 1) ? 1 : 31);

  const pacienteMap: Record<string, Paciente> = Object.fromEntries(pacientes.map((p) => [p.id, p]));

  const calMap = new Map<string, CalendarioPaciente>();
  calendarios.forEach((cal) => {
    if (!calMap.has(cal.paciente_id) && pacienteMap[cal.paciente_id]) calMap.set(cal.paciente_id, cal);
  });
  const calIds = new Set(calMap.keys());

  const buildRow = (paciente_id: string, nombre: string, tieneCal: boolean, cal: CalendarioPaciente | null): CobranzaRow => {
    const edit = edits[paciente_id] ?? { monto: 0, forma: "Efectivo" as FormaPago, sesiones: null, recargo: false };
    const conIva = CON_IVA_FORMAS.includes(edit.forma);
    const montoPagado = Number(edit.monto || 0);

    let totalSesiones: number | null = null;
    let montoEfectivo: number | null = null;

    if (tieneCal && cal) {
      const pac = pacienteMap[paciente_id];
      const horarioEfectivo = cal.horario && Object.values(cal.horario).some((v) => v && v.trim())
        ? cal.horario
        : (pac?.dias_sesion ?? {});
      const res = calcularSesionesDesdeCal({ ...cal, horario: horarioEfectivo as Record<string, string> }, params, pac);
      totalSesiones = res.totalSesiones;
      montoEfectivo = res.montoEfectivo;
    } else {
      const pac = pacienteMap[paciente_id];
      if (pac?.dias_sesion) {
        const res = calcularSesionesDesdeCal(
          { anio: filtroAnio, mes: filtroMes, horario: pac.dias_sesion as Record<string, string>, excepciones: "" },
          params,
          pac,
        );
        if (res.totalSesiones > 0) {
          totalSesiones = res.totalSesiones;
          montoEfectivo = res.montoEfectivo;
        }
      }
    }

    if (edit.sesiones !== null && edit.sesiones !== undefined) {
      totalSesiones = Number(edit.sesiones);
      // Precio por sesión: paciente.precio_sesion_regular si está definido (>0),
      // sino el precio derivado del calendario guardado, sino el global.
      const pac = pacienteMap[paciente_id];
      const precioPac = Number(pac?.precio_sesion_regular) || 0;
      const precioCal = cal && Number(cal.monto_efectivo) > 0 && Number(cal.total_sesiones) > 0
        ? Math.round(Number(cal.monto_efectivo) / Number(cal.total_sesiones))
        : 0;
      const precioEfectivo = precioPac || precioCal || precioRegular;
      montoEfectivo = totalSesiones * precioEfectivo;
    }

    const montoConRecargo = montoEfectivo !== null
      ? (edit.recargo ? Math.round(montoEfectivo * (1 + recargoPct)) : montoEfectivo)
      : null;

    const totalEsperado = montoConRecargo !== null
      ? (conIva ? Math.round(montoConRecargo * (1 + ivaRate)) : montoConRecargo)
      : null;

    const pagadoConIva = conIva ? Math.round(montoPagado * (1 + ivaRate)) : null;
    const saldoAFavor = saldosAFavor[paciente_id] || 0;

    let saldo: number | null = null;
    if (totalEsperado !== null) {
      const pagadoReal = conIva ? (pagadoConIva ?? 0) : montoPagado;
      const diff = totalEsperado - pagadoReal - saldoAFavor;
      saldo = Math.abs(diff) <= 50 ? 0 : diff;
    } else if (montoPagado > 0) {
      saldo = 0;
    }

    const saldoParaEstatus = saldo !== null ? saldo : (montoPagado > 0 ? 0 : 999);
    const estatus = estatusCxC(saldoParaEstatus, diaRef);

    return {
      paciente_id, nombre, tieneCal,
      totalSesiones, montoEfectivo: montoConRecargo, totalEsperado,
      montoPagado, pagadoConIva, saldo, saldoAFavor, estatus,
    };
  };

  const rowsConCal = Array.from(calMap.values()).map((cal) =>
    buildRow(cal.paciente_id, cal.paciente_nombre ?? "", true, cal),
  );

  const pacientesSinCal: Record<string, string> = {};
  const contarPagosPorPaciente: Record<string, number> = {};
  pagosDB.forEach((p) => {
    contarPagosPorPaciente[p.paciente_id] = (contarPagosPorPaciente[p.paciente_id] || 0) + 1;
  });
  pagosDB.filter((p) => !calIds.has(p.paciente_id)).forEach((p) => {
    if (!pacientesSinCal[p.paciente_id]) pacientesSinCal[p.paciente_id] = p.paciente_nombre ?? "";
  });
  const rowsSinCal = Object.entries(pacientesSinCal)
    .filter(([pid]) => !calMap.has(pid) && (contarPagosPorPaciente[pid] ?? 0) <= 1)
    .map(([pid, nombre]) => buildRow(pid, nombre, false, null));

  const rowsSinCalSinPago = pacientes
    .filter((pac) => !calIds.has(pac.id) && !pagosDB.some((p) => p.paciente_id === pac.id) && pacienteAplicaEnMes(pac, filtroMes, filtroAnio))
    .map((pac) => buildRow(pac.id, pac.nombre, false, null));

  const colorMap: Record<EstatusCxC["color"], string> = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    orange: "bg-orange-100 text-orange-700",
    red: "bg-red-100 text-red-700",
  };

  const allRows = new Map<string, CobranzaRow>();
  rowsConCal.forEach((r) => allRows.set(r.paciente_id, r));
  rowsSinCal.forEach((r) => { if (!allRows.has(r.paciente_id)) allRows.set(r.paciente_id, r); });
  rowsSinCalSinPago.forEach((r) => { if (!allRows.has(r.paciente_id)) allRows.set(r.paciente_id, r); });

  const cxcRows = Array.from(allRows.values())
    .filter((row) => {
      const pac = pacienteMap[row.paciente_id];
      if (!pac?.mes_inicio) return true;
      const inicio = (pac.anio_inicio || filtroAnio) * 100 + pac.mes_inicio;
      return filtroAnio * 100 + filtroMes >= inicio;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .filter((row) => !busqueda || row.nombre.toLowerCase().includes(busqueda.toLowerCase()));

  const setEdit = <K extends keyof EditState>(paciente_id: string, campo: K, valor: EditState[K]) => {
    setEdits((prev) => ({
      ...prev,
      [paciente_id]: {
        ...(prev[paciente_id] ?? { monto: 0, forma: "Efectivo" as FormaPago, sesiones: null, recargo: false }),
        [campo]: valor,
      },
    }));
  };

  const eliminarPago = async (pagoId: string | undefined) => {
    if (!pagoId) return;
    if (!confirm("¿Eliminar este registro de pago?")) return;
    try {
      await db.pago_terapia.delete(pagoId);
      toast.success("Pago eliminado");
      await cargarMes();
    } catch (err: any) {
      toast.error(err?.message || "Error al eliminar");
    }
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const ops: Promise<unknown>[] = [];
      for (const [paciente_id, edit] of Object.entries(edits)) {
        const existente = pagosDB.find((p) => p.paciente_id === paciente_id);
        if (existente) {
          ops.push(db.pago_terapia.update(existente.id, {
            monto_pagado: Number(edit.monto || 0),
            forma_pago: edit.forma,
            recargo: !!edit.recargo,
            dia_pago: new Date(existente.fecha_pago || new Date()).getDate(),
            ...(edit.sesiones !== null ? { sesiones_manual: Number(edit.sesiones) } : {}),
          }));
        } else if (Number(edit.monto || 0) > 0 || edit.sesiones !== null) {
          const pac = pacienteMap[paciente_id];
          ops.push(db.pago_terapia.create({
            paciente_id,
            paciente_nombre: pac?.nombre ?? "",
            anio: filtroAnio,
            mes: filtroMes,
            fecha_pago: new Date().toISOString().split("T")[0],
            dia_pago: new Date().getDate(),
            monto_pagado: Number(edit.monto || 0),
            forma_pago: edit.forma,
            recargo: !!edit.recargo,
            ...(edit.sesiones !== null ? { sesiones_manual: Number(edit.sesiones) } : {}),
          }));
        }
      }
      if (ops.length > 0) await Promise.all(ops);
      await cargarMes();
      setGuardadoOk(true);
      toast.success("Guardado correctamente");
      setTimeout(() => setGuardadoOk(false), 3000);
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Cobranza</h1>
            <p className="text-xs text-stone-400 mt-0.5 flex items-center gap-1">
              <Calendar size={12} /> Sesiones calculadas desde el calendario guardado del mes
            </p>
          </div>
          <div className="flex items-center gap-3">
            {guardadoOk && <span className="text-green-600 text-sm font-medium">✓ Guardado correctamente</span>}
            <button onClick={guardar} disabled={guardando}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-xl">
              <Save size={15} /> {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input placeholder="Buscar paciente..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-200" />
        </div>

        <div className="flex items-center gap-2">
          <select value={filtroMes} onChange={(e) => setFiltroMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={filtroAnio} onChange={(e) => setFiltroAnio(Number(e.target.value))}
            className="w-24 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Paciente</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Sesiones</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total Esperado</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Recargo 10%</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Forma de Pago</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Pagado (sin IVA)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Con IVA</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">A favor (mes ant.)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Estatus</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500"></th>
              </tr>
            </thead>
            <tbody>
              {cxcRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center">
                    <p className="text-stone-400 text-sm">No hay datos de cobranza para este mes</p>
                    <p className="text-stone-300 text-xs mt-1">Registra pagos o guarda calendarios desde la sección Calendarios</p>
                  </td>
                </tr>
              ) : (
                cxcRows.map((row) => {
                  const edit = edits[row.paciente_id] ?? { monto: 0, forma: "Efectivo" as FormaPago, sesiones: null, recargo: false };
                  return (
                    <tr key={row.paciente_id} className="border-t border-stone-50 hover:bg-stone-50/50">
                      <td className="px-4 py-3 font-medium text-stone-800">
                        {row.nombre}
                        {!row.tieneCal && <span className="ml-1 text-xs text-amber-500 font-normal">(sin calendario)</span>}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-stone-700">
                        <input type="number" min="0"
                          value={edit.sesiones ?? (row.tieneCal ? row.totalSesiones ?? "" : "")}
                          placeholder="—"
                          onChange={(e) => setEdit(row.paciente_id, "sesiones", e.target.value === "" ? null : Number(e.target.value))}
                          className="w-14 border border-stone-200 rounded-lg px-1 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      </td>
                      <td className="px-4 py-3 text-right text-stone-700">
                        {row.totalEsperado !== null ? fmtMXN(row.totalEsperado) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={!!edit.recargo}
                          onChange={(e) => setEdit(row.paciente_id, "recargo", e.target.checked)}
                          className="w-4 h-4 accent-orange-500 cursor-pointer"
                          title="Aplicar recargo del 10% por pago tardío" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <select value={edit.forma}
                          onChange={(e) => setEdit(row.paciente_id, "forma", e.target.value as FormaPago)}
                          className="w-28 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                          {FORMAS_PAGO.map((f) => <option key={f}>{f}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input type="number" min="0" value={edit.monto}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setEdit(row.paciente_id, "monto", Number(e.target.value))}
                          className="w-24 border border-stone-200 rounded-lg px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      </td>
                      <td className="px-4 py-3 text-right text-stone-700 font-medium">
                        {row.pagadoConIva !== null ? fmtMXN(row.pagadoConIva) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.saldoAFavor > 0 ? <span className="text-blue-600 font-medium">{fmtMXN(row.saldoAFavor)}</span> : <span className="text-stone-300">—</span>}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${row.saldo !== null && row.saldo > 0 ? "text-red-600" : "text-green-600"}`}>
                        {row.saldo !== null ? fmtMXN(Math.max(0, row.saldo)) : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[row.estatus.color]}`}>
                          {row.estatus.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => eliminarPago(pagosDB.find((p) => p.paciente_id === row.paciente_id)?.id)}
                          className="text-red-400 hover:text-red-600" title="Eliminar pago">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
