import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { generarCalendario, paramsToObject, fmtMXN, estatusCxC, MESES, pacienteAplicaEnMes } from "@/lib/calculos";
import { Calendar, Search, Save, Trash2 } from "lucide-react";

const FORMAS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Depósito"];
const DIAS_KEY = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const CON_IVA_FORMAS = ["Transferencia", "Tarjeta", "Depósito"];

function calcularSesionesDesdeCal(cal, params) {
  const { celdas } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, cal.excepciones || "");
  const reposicionesValidas = (cal.reposiciones || []).filter(r => r.dia && r.hora);
  const precioGlobal = Number(params.precio_terapia_regular || 1100);
  const precioPorSesion = Number(cal.monto_efectivo) && Number(cal.total_sesiones)
    ? Math.round(Number(cal.monto_efectivo) / Number(cal.total_sesiones))
    : precioGlobal;
  let montoEfectivo = 0, totalSesiones = 0;
  celdas.flat().forEach(celda => {
    if (celda.tipo !== "sesion") return;
    totalSesiones++;
    montoEfectivo += precioPorSesion;
  });
  reposicionesValidas.forEach(() => {
    totalSesiones++;
    montoEfectivo += precioPorSesion;
  });
  return { totalSesiones, montoEfectivo };
}

export default function Cobranza() {
  const [params, setParams] = useState({});
  const [pacientes, setPacientes] = useState([]);
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth() + 1);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  // Datos crudos de BD
  const [calendarios, setCalendarios] = useState([]);
  const [pagosDB, setPagosDB] = useState([]); // todos los PagoTerapia del mes
  const [saldosAFavor, setSaldosAFavor] = useState({}); // { [paciente_id]: montoAFavor }

  // Estado de edición: { [paciente_id]: { monto, forma, sesiones } }
  const [edits, setEdits] = useState({});
  const [deletingPagoId, setDeletingPagoId] = useState(null);
  const cargandoRef = useRef(false);

  // Carga inicial params
  useEffect(() => {
    base44.entities.Parametro.list().then(p => {
      setParams(paramsToObject(p));
    });
  }, []);

  // Cargar datos cuando cambia mes/año — siempre reinicia edits desde BD
  useEffect(() => {
    let cancelled = false;
    async function cargar() {
      const [cals, allPagos, allCals, allPacientes] = await Promise.all([
        base44.entities.CalendarioPaciente.filter({ mes: filtroMes, anio: filtroAnio }),
        base44.entities.PagoTerapia.list("-created_date", 500),
        base44.entities.CalendarioPaciente.list("-created_date", 1000),
        base44.entities.Paciente.filter({ estatus: "Activo" }, "nombre", 300),
      ]);
      if (cancelled) return;
      setPacientes(allPacientes);

      // Filtrar pagos del mes/año en memoria (cubre registros con anio null)
      const pagosMes = allPagos.filter(p => p.mes === filtroMes && (p.anio === filtroAnio || (!p.anio && filtroAnio === 2026)));

      // Calcular saldos a favor de meses anteriores por paciente
      // Solo aplica a partir de Junio 2026 (Mayo es el primer mes base)
      const mesBaseInicio = { anio: 2026, mes: 5 }; // Mayo 2026 es el punto de partida
      const filtroEsAnteriorABase = filtroAnio < mesBaseInicio.anio || (filtroAnio === mesBaseInicio.anio && filtroMes <= mesBaseInicio.mes);
      const pagosAnteriores = filtroEsAnteriorABase ? [] : allPagos.filter(p => {
        const pAnio = p.anio || 2026;
        return pAnio < filtroAnio || (pAnio === filtroAnio && p.mes < filtroMes);
      });

      const saldos = {};
      // Agrupar pagos anteriores por paciente y mes
      const porPacMes = {};
      pagosAnteriores.forEach(p => {
        const key = `${p.paciente_id}_${p.anio || 2026}_${p.mes}`;
        if (!porPacMes[key]) porPacMes[key] = { paciente_id: p.paciente_id, anio: p.anio || 2026, mes: p.mes, pagos: [] };
        porPacMes[key].pagos.push(p);
      });

      // Para cada grupo, calcular si hubo saldo a favor (pagó de más)
      // monto_pagado en BD = total efectivamente recibido (con IVA si non-Efectivo)
      const ivaRateLocal = Number(params.iva || 0.16);
      const precioRegularLocal = Number(params.precio_terapia_regular || 1100);
      Object.values(porPacMes).forEach(({ paciente_id, anio, mes, pagos }) => {
        const montoPagadoTotal = pagos.reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
        const forma = pagos[0]?.forma_pago || "Efectivo";
        const conIva = CON_IVA_FORMAS.includes(forma);

        // Buscar calendario de ese mes para saber el total esperado
        const cal = allCals.find(c => c.paciente_id === paciente_id && c.anio === anio && c.mes === mes);
        let totalEsperado = null;
        if (cal) {
          // Calcular desde calendario
          const pReg = Number(params.precio_terapia_regular || 1100);
          const pMat = Number(params.precio_terapia_matutina || 900);
          let monto = 0;
          const diasKey = ["lunes","martes","miercoles","jueves","viernes","sabado","domingo"];
          const { celdas } = generarCalendario(anio, mes, cal.horario || {}, cal.excepciones || "");
          celdas.flat().forEach(c => {
            if (c.tipo !== "sesion") return;
            const tipo = cal.tipo_sesion?.[diasKey[c.diaSemana]] || "Regular";
            monto += tipo === "Matutina" ? pMat : pReg;
          });
          (cal.reposiciones || []).filter(r => r.dia && r.hora).forEach(r => {
            monto += r.tipoRep === "Matutina" ? pMat : pReg;
          });
          const recargoPago = pagos[0]?.recargo ? monto * 0.10 : 0;
          monto += recargoPago;
          totalEsperado = conIva ? Math.round(monto * (1 + ivaRateLocal)) : monto;
        } else if (pagos[0]?.sesiones_manual != null) {
          const ses = Number(pagos[0].sesiones_manual);
          const monto = ses * precioRegularLocal;
          totalEsperado = conIva ? Math.round(monto * (1 + ivaRateLocal)) : monto;
        }

        if (totalEsperado !== null) {
          const diferencia = montoPagadoTotal - totalEsperado; // positivo = saldo a favor
          if (diferencia > 0) {
            saldos[paciente_id] = (saldos[paciente_id] || 0) + diferencia;
          }
        }
      });

      setSaldosAFavor(saldos);
      // Filtrar calendarios: solo los cuyo paciente aplica en ese mes/año
      const calsValidas = cals.filter(cal => {
        const pac = allPacientes.find(p => p.id === cal.paciente_id);
        return pac && pacienteAplicaEnMes(pac, cal.mes, cal.anio);
      });
      setCalendarios(calsValidas);
      setPagosDB(pagosMes);

      // Si es Abril, limpiar duplicados automáticamente
      let pagosMesUsables = pagosMes;
      if (filtroMes === 4) {
        try {
          await base44.functions.invoke('limpiarAbril', {});
          // Recargar después de limpiar
          const freshPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
          pagosMesUsables = freshPagos.filter(p => p.mes === filtroMes && (p.anio === filtroAnio || (!p.anio && filtroAnio === 2026)));
        } catch (e) {
          console.warn("Advertencia al limpiar duplicados:", e);
          // Continuar con los datos actuales si falla
        }
      }

      // Inicializar edits agrupando por paciente
      const porPaciente = {};
      pagosMesUsables.forEach(p => {
        if (!porPaciente[p.paciente_id]) porPaciente[p.paciente_id] = [];
        porPaciente[p.paciente_id].push(p);
      });
      const nuevosEdits = {};
      Object.entries(porPaciente).forEach(([pid, lista]) => {
        nuevosEdits[pid] = {
          monto: lista.reduce((s, p) => s + Number(p.monto_pagado || 0), 0),
          forma: lista[0]?.forma_pago || "Efectivo",
          sesiones: lista.find(p => p.sesiones_manual != null)?.sesiones_manual ?? null,
          recargo: lista[0]?.recargo || false,
        };
      });
      setEdits(nuevosEdits);
      setPagosDB(pagosMesUsables);
    }
    cargar();
    return () => { cancelled = true; };
  }, [filtroMes, filtroAnio, params]);

  const ivaRate = Number(params.iva || 0.16);
  const precioRegular = Number(params.precio_terapia_regular || 1100);

  const hoy = new Date();
  const esMesActual = filtroAnio === hoy.getFullYear() && filtroMes === hoy.getMonth() + 1;
  const diaRef = esMesActual ? hoy.getDate() : (filtroAnio > hoy.getFullYear() || (filtroAnio === hoy.getFullYear() && filtroMes > hoy.getMonth() + 1) ? 1 : 31);

  const pacienteMap = Object.fromEntries(pacientes.map(p => [p.id, p]));

  // Construir filas
  const calMap = new Map();
  calendarios.forEach(cal => {
    const key = cal.paciente_id;
    if (!calMap.has(key) && pacientes.some(p => p.id === key)) calMap.set(key, cal);
  });
  const calIds = new Set(calMap.keys());

  const buildRow = (paciente_id, nombre, tieneCal, cal) => {
    const edit = edits[paciente_id] || { monto: 0, forma: "Efectivo", sesiones: null, recargo: false };
    const forma = edit.forma;
    const conIva = CON_IVA_FORMAS.includes(forma);
    const montoPagado = Number(edit.monto || 0);
    const recargoPct = Number(params.recargo_pago_tarde || 0.10);

    let totalSesiones = null;
    let montoEfectivo = null;

    if (tieneCal) {
      // Si el calendario guardado tiene horario vacío, usar dias_sesion del perfil como fallback
      const horarioEfectivo = cal.horario && Object.values(cal.horario).some(v => v && v.trim())
        ? cal.horario
        : (pacienteMap[paciente_id] && pacienteMap[paciente_id].dias_sesion ? pacienteMap[paciente_id].dias_sesion : {});
      const res = calcularSesionesDesdeCal({ ...cal, horario: horarioEfectivo }, params);
      totalSesiones = res.totalSesiones;
      montoEfectivo = res.montoEfectivo;
    } else {
      const pac = pacienteMap[paciente_id];
      if (pac && pac.dias_sesion) {
        const res = calcularSesionesDesdeCal(
          { anio: filtroAnio, mes: filtroMes, horario: pac.dias_sesion, excepciones: '' },
          params
        );
        if (res.totalSesiones > 0) {
          totalSesiones = res.totalSesiones;
          montoEfectivo = res.montoEfectivo;
        }
      }
    }

    // Sesiones manuales sobreescriben calendario si el usuario las editó
    const sesManual = edit.sesiones;
    if (sesManual !== null && sesManual !== undefined) {
      totalSesiones = Number(sesManual);
      montoEfectivo = totalSesiones * precioRegular;
    }

    const montoConRecargo = montoEfectivo !== null
      ? (edit.recargo ? Math.round(montoEfectivo * (1 + recargoPct)) : montoEfectivo)
      : null;

    const totalEsperado = montoConRecargo !== null
      ? (conIva ? Math.round(montoConRecargo * (1 + ivaRate)) : montoConRecargo)
      : null;

    // monto_pagado es el TOTAL recibido (ya con IVA si conIva) — el sistema lo
    // espera así en todos los consumers (Terapias, Para el Contador, etc.)
    const saldoAFavor = saldosAFavor[paciente_id] || 0;

    let saldo = null;
    if (totalEsperado !== null) {
      const diff = totalEsperado - montoPagado - saldoAFavor;
      saldo = Math.abs(diff) <= 50 ? 0 : diff;
    } else if (montoPagado > 0) {
      saldo = 0;
    }

    const saldoParaEstatus = saldo !== null ? saldo : (montoPagado > 0 ? 0 : 999);
    const estatus = estatusCxC(saldoParaEstatus, diaRef);

    return { paciente_id, nombre, tieneCal, totalSesiones, montoEfectivo: montoConRecargo, totalEsperado, montoPagado, saldo, saldoAFavor, estatus };
  };

  // Filas con calendario
  const rowsConCal = Array.from(calMap.values()).map(cal =>
    buildRow(cal.paciente_id, cal.paciente_nombre, true, cal)
  );

  // Filas sin calendario pero con pago registrado
  // Solo incluir si NO tiene calendario O si tiene múltiples pagos en el mes (duplicados genuinos)
  const pacientesSinCal = {};
  const contarPagosPorPaciente = {};
  pagosDB.forEach(p => {
    contarPagosPorPaciente[p.paciente_id] = (contarPagosPorPaciente[p.paciente_id] || 0) + 1;
  });
  
  pagosDB.filter(p => !calIds.has(p.paciente_id)).forEach(p => {
    if (!pacientesSinCal[p.paciente_id]) pacientesSinCal[p.paciente_id] = p.paciente_nombre;
  });
  const rowsSinCal = Object.entries(pacientesSinCal)
    .filter(([pid]) => {
      // Incluir SOLO si no tiene calendario en calMap
      // O si tiene múltiples pagos (significa que tiene calendario + pago sin calendario = duplicado)
      const tieneCalendario = calMap.has(pid);
      const tieneMultiplesPagos = contarPagosPorPaciente[pid] > 1;
      return !tieneCalendario && !tieneMultiplesPagos;
    })
    .map(([pid, nombre]) =>
      buildRow(pid, nombre, false, null)
    );

  // Pacientes sin calendario ni pago — fallback a dias_sesion del perfil
  const rowsSinCalSinPago = pacientes
    .filter(pac => {
      // Solo incluir si no tiene calendario guardado ese mes
      if (calIds.has(pac.id)) return false;
      // Y no tiene pago registrado ese mes
      if (pagosDB.some(p => p.paciente_id === pac.id)) return false;
      // Aplica la regla unificada de fechas
      return pacienteAplicaEnMes(pac, filtroMes, filtroAnio);
    })
    .map(pac => buildRow(pac.id, pac.nombre, false, null));


  const colorMap = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    orange: "bg-orange-100 text-orange-700",
    red: "bg-red-100 text-red-700"
  };

  // Combinar: Si paciente tiene calendario, SOLO esa. Si no tiene, mostrar la sin calendario
  const allRows = new Map();
  
  // Agregar todos los con calendario
  rowsConCal.forEach(row => {
    allRows.set(row.paciente_id, row);
  });
  
  // Agregar los sin calendario SOLO si no tienen calendario
  rowsSinCal.forEach(row => {
    if (!allRows.has(row.paciente_id)) {
      allRows.set(row.paciente_id, row);
    }
  });
  // Pacientes activos sin calendario y sin pago: usar dias_sesion como fallback
  rowsSinCalSinPago.forEach(row => {
    if (!allRows.has(row.paciente_id)) {
      allRows.set(row.paciente_id, row);
    }
  });
  
  const cxcRows = Array.from(allRows.values())
    .filter(row => {
      const pac = pacienteMap[row.paciente_id];
      if (!pac?.mes_inicio) return true;
      const inicio = (pac.anio_inicio || 2026) * 100 + pac.mes_inicio;
      return filtroAnio * 100 + filtroMes >= inicio;
    })
    .sort((a, b) => a.nombre?.localeCompare(b.nombre))
    .filter(row => !busqueda || row.nombre?.toLowerCase().includes(busqueda.toLowerCase()));

  const hayEdits = Object.keys(edits).length > 0;

  const setEdit = (paciente_id, campo, valor) => {
    setEdits(prev => ({
      ...prev,
      [paciente_id]: { ...(prev[paciente_id] || { monto: 0, forma: "Efectivo", sesiones: null, recargo: false }), [campo]: valor }
    }));
  };

  const eliminarPago = async (pagoId) => {
    if (!confirm("¿Eliminar este registro de pago?")) return;
    try {
      await base44.entities.PagoTerapia.delete(pagoId);
      const freshPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
      const pagosMes = freshPagos.filter(p => p.mes === filtroMes && (p.anio === filtroAnio || (!p.anio && filtroAnio === 2026)));
      setPagosDB(pagosMes);
      setDeletingPagoId(null);
    } catch (err) {
      console.error("Error eliminando:", err);
      alert("Error al eliminar: " + err.message);
    }
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const ops = [];
      for (const [paciente_id, edit] of Object.entries(edits)) {
        // Buscar pago existente en BD
        const existente = pagosDB.find(p => p.paciente_id === paciente_id);
        if (existente) {
          ops.push(base44.entities.PagoTerapia.update(existente.id, {
            monto_pagado: Number(edit.monto || 0),
            forma_pago: edit.forma,
            recargo: !!edit.recargo,
            dia_pago: new Date(existente.fecha_pago || new Date()).getDate(),
            ...(edit.sesiones !== null ? { sesiones_manual: Number(edit.sesiones) } : {}),
          }));
        } else {
          // Solo crear si hay algo que guardar
          if (Number(edit.monto || 0) > 0 || edit.sesiones !== null) {
            const pac = pacienteMap[paciente_id];
            ops.push(base44.entities.PagoTerapia.create({
              paciente_id,
              paciente_nombre: pac?.nombre || "",
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
      }
      if (ops.length > 0) await Promise.all(ops);

      // Recargar pagosDB para tener los IDs actualizados (sin tocar edits)
      const freshPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
      const pagosMes = freshPagos.filter(p => p.mes === filtroMes && (p.anio === filtroAnio || (!p.anio && filtroAnio === 2026)));
      setPagosDB(pagosMes);

      setGuardadoOk(true);
      setTimeout(() => setGuardadoOk(false), 3000);
    } catch (err) {
      console.error("Error guardando:", err);
      alert("Error al guardar: " + err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">Cobranza</h1>
            <p className="text-xs text-stone-400 mt-0.5 flex items-center gap-1">
              <Calendar size={12} /> Sesiones calculadas desde el calendario guardado del mes
            </p>
          </div>
          <div className="flex items-center gap-3">
            {guardadoOk && (
              <span className="text-green-600 text-sm font-medium">✓ Guardado correctamente</span>
            )}

            <button
              onClick={guardar}
              disabled={guardando}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <Save size={15} />
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            placeholder="Buscar paciente..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
          />
        </div>

        <div className="flex items-center gap-2">
          <select value={filtroMes} onChange={e => setFiltroMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={filtroAnio} onChange={e => setFiltroAnio(Number(e.target.value))}
            className="w-20 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
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
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">A favor (mes ant.)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Estatus</th>
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
              ) : cxcRows.map((row, i) => {
                const edit = edits[row.paciente_id] || { monto: 0, forma: "Efectivo", sesiones: null };
                return (
                  <tr key={row.paciente_id} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 font-medium text-stone-800">
                      {row.nombre}
                      {!row.tieneCal && (
                        <span className="ml-1 text-xs text-amber-500 font-normal">(sin calendario)</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center font-medium text-stone-700">
                      <input
                        type="number"
                        min="0"
                        value={edit.sesiones ?? (row.tieneCal ? row.totalSesiones : "")}
                        placeholder="—"
                        onChange={e => setEdit(row.paciente_id, "sesiones", e.target.value === "" ? null : Number(e.target.value))}
                        className="w-14 border border-stone-200 rounded-lg px-1 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                    </td>

                    <td className="px-4 py-3 text-right text-stone-700">
                      {row.totalEsperado !== null ? fmtMXN(row.totalEsperado) : <span className="text-stone-300">—</span>}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={!!edit.recargo}
                        onChange={e => setEdit(row.paciente_id, "recargo", e.target.checked)}
                        className="w-4 h-4 accent-orange-500 cursor-pointer"
                        title="Aplicar recargo del 10% por pago tardío"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <select
                        value={edit.forma}
                        onChange={e => setEdit(row.paciente_id, "forma", e.target.value)}
                        className="w-28 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        {FORMAS_PAGO.map(f => <option key={f}>{f}</option>)}
                      </select>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min="0"
                        value={edit.monto}
                        onFocus={e => e.target.select()}
                        onChange={e => setEdit(row.paciente_id, "monto", Number(e.target.value))}
                        className="w-24 border border-stone-200 rounded-lg px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                        title="Monto neto recibido (lo que efectivamente entró a la cuenta)"
                      />
                    </td>

                    <td className="px-4 py-3 text-right">
                      {row.saldoAFavor > 0
                        ? <span className="text-blue-600 font-medium">{fmtMXN(row.saldoAFavor)}</span>
                        : <span className="text-stone-300">—</span>}
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
                      <button
                        onClick={() => eliminarPago(pagosDB.find(p => p.paciente_id === row.paciente_id)?.id)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Eliminar este registro de pago"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}