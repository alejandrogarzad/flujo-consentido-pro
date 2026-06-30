"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Search, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db, type AuthUser } from "@/lib/db";
import { canEditSesiones, canDeletePago } from "@/lib/permissions";
import { precioPorSesion } from "@/lib/calculos";
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
  saldo: number | null;
  saldoAFavor: number;
  estatus: EstatusCxC;
}

function calcularSesionesDesdeCal(
  cal: { anio: number; mes: number; horario: Record<string, string>; excepciones?: string | null; reposiciones?: any[]; total_sesiones?: number; monto_efectivo?: number; monto_override?: number | null },
  params: ParamMap,
  paciente?: Paciente | null,
) {
  // Precio LIVE: usa helper que respeta convención NULL = global, 0 = literal.
  const precioReg = precioPorSesion(paciente, params, "Regular");

  // Override manual del calendario: si está seteado, RESPETARLO siempre
  // (incluso si es 0). El override representa el monto efectivo acordado
  // para ese mes específico (ej. paciente que paga menos de lo calculado).
  const savedSes = Number(cal.total_sesiones) || 0;
  if (cal.monto_override !== null && cal.monto_override !== undefined) {
    return { totalSesiones: savedSes, montoEfectivo: Number(cal.monto_override) };
  }

  // Conteo de sesiones: trust the saved cal.total_sesiones (aplica asuetos
  // y reposiciones correctamente). Solo recompute si no hay valor guardado.
  if (savedSes > 0) {
    return { totalSesiones: savedSes, montoEfectivo: savedSes * precioReg };
  }
  const { celdas } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, cal.excepciones || "");
  const reposicionesValidas = (cal.reposiciones || []).filter((r: any) => r.dia && r.hora);
  let montoEfectivo = 0;
  let totalSesiones = 0;
  celdas.flat().forEach((c) => {
    if (c.tipo !== "sesion") return;
    totalSesiones++;
    montoEfectivo += precioReg;
  });
  reposicionesValidas.forEach(() => {
    totalSesiones++;
    montoEfectivo += precioReg;
  });
  return { totalSesiones, montoEfectivo };
}

// Cálculo ÚNICO del esperado de un mes — usado tanto por la vista del mes
// actual (buildRow) como por el arrastre de saldos de meses anteriores, para
// que NUNCA difieran (antes el arrastre usaba sesiones_matutinas/regulares y
// generaba deudas fantasma frente a meses que en su propia vista cuadraban).
function calcularEsperadoMes(
  cal: CalendarioPaciente | null,
  sesionesManual: number | null,
  forma: FormaPago,
  recargo: boolean,
  params: ParamMap,
  paciente: Paciente | null | undefined,
  mes: number,
  anio: number,
): { totalSesiones: number | null; montoConRecargo: number | null; totalEsperado: number | null } {
  const ivaRate = Number(params.iva ?? 0.16);
  const recargoPct = Number(params.recargo_pago_tarde ?? 0.1);
  const conIva = CON_IVA_FORMAS.includes(forma);
  const precioReg = precioPorSesion(paciente ?? null, params, "Regular");

  let totalSesiones: number | null = null;
  let montoEfectivo: number | null = null;

  if (cal) {
    const horarioEfectivo = cal.horario && Object.values(cal.horario).some((v) => v && v.trim())
      ? cal.horario
      : (paciente?.dias_sesion ?? {});
    const res = calcularSesionesDesdeCal({ ...cal, horario: horarioEfectivo as Record<string, string> }, params, paciente);
    totalSesiones = res.totalSesiones;
    montoEfectivo = res.montoEfectivo;
  } else if (paciente?.dias_sesion) {
    const res = calcularSesionesDesdeCal(
      { anio, mes, horario: paciente.dias_sesion as Record<string, string>, excepciones: "" },
      params, paciente,
    );
    if (res.totalSesiones > 0) {
      totalSesiones = res.totalSesiones;
      montoEfectivo = res.montoEfectivo;
    }
  }

  // sesiones_manual (override del pago) toma precedencia, igual que buildRow
  if (sesionesManual !== null && sesionesManual !== undefined) {
    totalSesiones = Number(sesionesManual);
    montoEfectivo = totalSesiones * precioReg;
  }

  const montoConRecargo = montoEfectivo !== null
    ? (recargo ? Math.round(montoEfectivo * (1 + recargoPct)) : montoEfectivo)
    : null;
  const totalEsperado = montoConRecargo !== null
    ? (conIva ? Math.round(montoConRecargo * (1 + ivaRate)) : montoConRecargo)
    : null;

  return { totalSesiones, montoConRecargo, totalEsperado };
}

export default function CobranzaPage() {
  const [params, setParams] = useState<ParamMap>({});
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth() + 1);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [calendarios, setCalendarios] = useState<CalendarioPaciente[]>([]);
  const [pagosDB, setPagosDB] = useState<PagoTerapia[]>([]);
  const [saldosAFavor, setSaldosAFavor] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, EditState>>({});

  // Permisos del rol actual
  const canEditSes = canEditSesiones(currentUser?.role);
  const canDel = canDeletePago(currentUser?.role);

  // Cargar params + usuario
  useEffect(() => {
    db.parametro.list("clave").then((p) => setParams(paramsToObject(p)));
    db.auth.me().then(setCurrentUser);
  }, []);

  const cargarMes = useCallback(async () => {
    if (Object.keys(params).length === 0) return;
    try {
      // IMPORTANTE: usamos listAll() (paginado) en lugar de list(limit),
      // porque Supabase tiene un cap server-side de 1000 filas por query.
      // Si la tabla pasa de 1000, list("-created_date", 20000) regresa solo
      // 1000 — y los 29+ calendarios más viejos quedan fuera. Eso causaba
      // que el "Saldo previo" de mayo no encontrara el cal real de algunos
      // pacientes, cayera al fallback de `dias_sesion`, ignorara las
      // excepciones del calendario (feriados, asuetos), y generara deudas
      // fantasma. Caso real reportado: Andrés Gómez Escamilla con cal real
      // de 8 sesiones (excepción día 1), fallback contaba 9 (4 mié + 5 vie),
      // saldo fantasma de -$1,100 arrastrado a junio.
      const [cals, allPagos, allCals, allPacientes] = await Promise.all([
        db.calendario_paciente.filter({ mes: filtroMes, anio: filtroAnio }),
        db.pago_terapia.listAll("-created_date"),
        db.calendario_paciente.listAll("-created_date"),
        db.paciente.filter({ estatus: "Activo" }, "nombre", 1000),
      ]);
      setPacientes(allPacientes);

      const pagosMes = allPagos.filter((p) => p.mes === filtroMes && p.anio === filtroAnio);

      // Saldos arrastrados (a favor o en contra) desde mayo 2026 hasta el mes
      // anterior al filtrado. Por cada (paciente, mes) en el rango calculamos
      // expected vs paid; la suma queda en `saldos` (signed):
      //   > 0: paciente tiene crédito (a favor)
      //   < 0: paciente debe (en contra) — se arrastra al mes filtrado
      const mesBaseInicio = { anio: 2026, mes: 5 };
      const baseVal = mesBaseInicio.anio * 100 + mesBaseInicio.mes;
      const filtroVal = filtroAnio * 100 + filtroMes;
      const filtroEsAnteriorABase = filtroVal <= baseVal;

      const pacMapAnt = Object.fromEntries(allPacientes.map((p) => [p.id, p]));
      const saldos: Record<string, number> = {};

      if (!filtroEsAnteriorABase) {
        // Pagos solo entre mayo (incl) y mes anterior al filtrado (excl)
        const pagosEnRango = allPagos.filter((p) => {
          const pVal = (p.anio || 2026) * 100 + p.mes;
          return pVal >= baseVal && pVal < filtroVal;
        });
        // Calendarios en el mismo rango (capturan deuda aunque no haya pago)
        const calsEnRango = allCals.filter((c) => {
          const cVal = (c.anio || 0) * 100 + (c.mes || 0);
          return cVal >= baseVal && cVal < filtroVal;
        });

        // Combinar claves (paciente_id, anio, mes) de pagos + calendarios
        const pagosPorKey: Record<string, PagoTerapia[]> = {};
        const claves = new Set<string>();
        pagosEnRango.forEach((p) => {
          const k = `${p.paciente_id}|${p.anio || 2026}|${p.mes}`;
          claves.add(k);
          (pagosPorKey[k] = pagosPorKey[k] || []).push(p);
        });
        calsEnRango.forEach((c) => {
          claves.add(`${c.paciente_id}|${c.anio}|${c.mes}`);
        });

        claves.forEach((k) => {
          const [paciente_id, anioStr, mesStr] = k.split("|");
          const anio = Number(anioStr);
          const mes = Number(mesStr);
          const pac = pacMapAnt[paciente_id];
          if (!pac) return;
          if (!pacienteAplicaEnMes(pac, mes, anio)) return;

          const pagos = pagosPorKey[k] || [];
          const cal = allCals.find((c) => c.paciente_id === paciente_id && c.anio === anio && c.mes === mes) || null;
          const montoPagadoTotal = pagos.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
          const forma = pagos[0]?.forma_pago || pac.forma_pago_default || "Efectivo";
          const sesionesManual = pagos.find((p) => p.sesiones_manual != null)?.sesiones_manual ?? null;
          const recargo = pagos[0]?.recargo || false;

          // Mismo cálculo que la vista del mes (buildRow) para que un mes
          // cuadrado no genere deuda fantasma al arrastrarse.
          const { totalEsperado } = calcularEsperadoMes(cal, sesionesManual, forma, recargo, params, pac, mes, anio);

          // totalEsperado puede ser 0 legítimo (override=0, beca completa).
          // monto_pagado en BD = total efectivamente recibido (con IVA si non-Efectivo)
          if (totalEsperado !== null && totalEsperado >= 0) {
            const dif = montoPagadoTotal - totalEsperado;
            // Tolerancia $50 (ruido de IVA/redondeo). Acumula AMBAS direcciones:
            //   dif > 50  → saldo a favor (positivo)
            //   dif < -50 → saldo en contra (negativo, se arrastra como deuda)
            if (Math.abs(dif) > 50) {
              saldos[paciente_id] = (saldos[paciente_id] || 0) + dif;
            }
          }
        });
      }
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
    const montoPagado = Number(edit.monto || 0);
    const pac = pacienteMap[paciente_id];

    const { totalSesiones, montoConRecargo, totalEsperado } = calcularEsperadoMes(
      tieneCal ? cal : null, edit.sesiones, edit.forma, edit.recargo, params, pac, filtroMes, filtroAnio,
    );

    // monto_pagado es el TOTAL recibido (ya con IVA si conIva). Sin inflar.
    const saldoAFavor = saldosAFavor[paciente_id] || 0;

    let saldo: number | null = null;
    if (totalEsperado !== null) {
      const diff = totalEsperado - montoPagado - saldoAFavor;
      saldo = Math.abs(diff) <= 50 ? 0 : diff;
    } else if (montoPagado > 0) {
      saldo = 0;
    }

    const saldoParaEstatus = saldo !== null ? saldo : (montoPagado > 0 ? 0 : 999);
    const estatus = estatusCxC(saldoParaEstatus, diaRef);

    return {
      paciente_id, nombre, tieneCal,
      totalSesiones, montoEfectivo: montoConRecargo, totalEsperado,
      montoPagado, saldo, saldoAFavor, estatus,
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
          <select
            value={filtroMes}
            onChange={(e) => setFiltroMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
          >
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            value={filtroAnio}
            onChange={(e) => setFiltroAnio(Number(e.target.value))}
            className="w-24 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
          />
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
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Pagado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo previo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Estatus</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500"></th>
              </tr>
            </thead>
            <tbody>
              {cxcRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center">
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
                          disabled={!canEditSes}
                          title={!canEditSes ? "Solo el admin puede ajustar sesiones" : undefined}
                          className="w-14 border border-stone-200 rounded-lg px-1 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed" />
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
                          title="Monto neto recibido (lo que efectivamente entró a la cuenta, con IVA si aplica)"
                          className="w-24 border border-stone-200 rounded-lg px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.saldoAFavor === 0 ? (
                          <span className="text-stone-300">—</span>
                        ) : row.saldoAFavor > 0 ? (
                          <span className="text-blue-600 font-medium" title="Saldo a favor del mes anterior">
                            +{fmtMXN(row.saldoAFavor)}
                          </span>
                        ) : (
                          <span className="text-red-600 font-medium" title="Deuda arrastrada del mes anterior">
                            {fmtMXN(row.saldoAFavor)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {row.saldo === null ? (
                          <span className="text-stone-300">—</span>
                        ) : row.saldo > 0 ? (
                          <span className="text-red-600">{fmtMXN(row.saldo)}</span>
                        ) : row.saldo < 0 ? (
                          <span className="text-blue-600" title="Pagó de más — saldo a favor que se arrastra al mes siguiente">
                            +{fmtMXN(-row.saldo)} a favor
                          </span>
                        ) : (
                          <span className="text-green-600">{fmtMXN(0)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[row.estatus.color]}`}>
                          {row.estatus.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {canDel && (
                          <button onClick={() => eliminarPago(pagosDB.find((p) => p.paciente_id === row.paciente_id)?.id)}
                            className="text-red-400 hover:text-red-600" title="Eliminar pago">
                            <Trash2 size={14} />
                          </button>
                        )}
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
