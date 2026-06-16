"use client";

import { useState, useEffect, useCallback } from "react";
import { Printer, Plus, Trash2, Save, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import {
  generarCalendario, fmtMXN, MESES, paramsToObject, DIAS_SEMANA, pacienteAplicaEnMes,
  precioPorSesion,
  type ParamMap,
} from "@/lib/calculos";
import type {
  CalendarioPaciente, DiaSemana, HorarioSemanal, Paciente, Reposicion, TipoSesionSemanal,
} from "@/types/db";
import { BrandLogo } from "@/components/ConsentidoLogo";

const DIAS_KEY: DiaSemana[] = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

const emptyHorario = (): HorarioSemanal => ({ lunes: "", martes: "", miercoles: "", jueves: "", viernes: "", sabado: "", domingo: "" });
const emptyTipoSesion = (): TipoSesionSemanal => ({
  lunes: "Regular", martes: "Regular", miercoles: "Regular", jueves: "Regular", viernes: "Regular", sabado: "Regular", domingo: "Regular",
});

interface Celda {
  dia: number | null;
  tipo: "vacio" | "sesion" | "excepcion" | "libre";
  hora?: string;
  diaSemana?: number;
}

function calcularMontos(
  celdas: Celda[][],
  paciente: Paciente | null,
  params: ParamMap,
  reposicionesValidas: Reposicion[],
) {
  const ivaRate = Number(params.iva ?? 0.16);
  const precioReg = precioPorSesion(paciente, params, "Regular");

  let montoEfectivo = 0;
  celdas.flat().forEach((c) => {
    if (c.tipo === "sesion") montoEfectivo += precioReg;
  });
  reposicionesValidas.forEach(() => {
    montoEfectivo += precioReg;
  });
  const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));
  return { montoEfectivo, montoTransferencia };
}

async function upsertSesionMensual(args: {
  paciente_id: string;
  paciente_nombre: string | null;
  anio: number;
  mes: number;
  sesiones_matutinas: number;
  sesiones_regulares: number;
  excepciones_dias: string;
  monto_override: number | null;
}) {
  const existing = await db.sesion_mensual.filter({
    paciente_id: args.paciente_id,
    anio: args.anio,
    mes: args.mes,
  });
  if (existing.length > 0) {
    await db.sesion_mensual.update(existing[0].id, {
      sesiones_matutinas: args.sesiones_matutinas,
      sesiones_regulares: args.sesiones_regulares,
      paciente_nombre: args.paciente_nombre,
      excepciones_dias: args.excepciones_dias || "",
      monto_override: args.monto_override,
    });
  } else {
    await db.sesion_mensual.create({
      paciente_id: args.paciente_id,
      paciente_nombre: args.paciente_nombre,
      anio: args.anio,
      mes: args.mes,
      sesiones_matutinas: args.sesiones_matutinas,
      sesiones_regulares: args.sesiones_regulares,
      excepciones_dias: args.excepciones_dias || "",
      monto_override: args.monto_override,
      beca_porcentaje: 0,
      forma_pago_mes: "Efectivo",
    });
  }
}

export default function CalendariosPage() {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [params, setParams] = useState<ParamMap>({});
  const [pacienteId, setPacienteId] = useState("");
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [horario, setHorario] = useState<HorarioSemanal>(emptyHorario());
  const [tipoSesion, setTipoSesion] = useState<TipoSesionSemanal>(emptyTipoSesion());
  const [terapeutas, setTerapeutas] = useState<HorarioSemanal>(emptyHorario());
  const [excepciones, setExcepciones] = useState("");
  const [pagado, setPagado] = useState("");
  const [asuetos, setAsuetos] = useState("");
  const [reposiciones, setReposiciones] = useState<Reposicion[]>([]);
  const [calendarios, setCalendarios] = useState<CalendarioPaciente[]>([]);
  const [montoOverride, setMontoOverride] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [guardandoAsuetos, setGuardandoAsuetos] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [llenandoCalendarios, setLlenandoCalendarios] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const loadInicial = useCallback(async () => {
    try {
      const [p, par, cals] = await Promise.all([
        db.paciente.filter({ estatus: "Activo" }, "nombre", 500),
        db.parametro.list("clave"),
        db.calendario_paciente.listAll(),
      ]);
      const parObj = paramsToObject(par);
      const claveAsuetos = `asuetos_${anio}_${mes}`;
      setAsuetos(String(parObj[claveAsuetos] ?? ""));

      const pacientesConCal = new Set(cals.map((c) => c.paciente_id));
      const map = new Map<string, Paciente>();
      p.forEach((pac) => {
        const key = pac.nombre.toLowerCase().trim();
        const existing = map.get(key);
        if (!existing) {
          map.set(key, pac);
        } else {
          const hasCalPac = pacientesConCal.has(pac.id);
          const hasCalExisting = pacientesConCal.has(existing.id);
          if (hasCalPac && !hasCalExisting) {
            map.set(key, pac);
          } else if (!hasCalExisting && !hasCalPac && pac.mes_inicio && !existing.mes_inicio) {
            map.set(key, pac);
          }
        }
      });
      const unique = Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPacientes(unique);
      setParams(parObj);

      const pacMap = Object.fromEntries(p.map((pac) => [pac.id, pac]));
      const calsValidas = cals.filter((cal) => {
        const pac = pacMap[cal.paciente_id];
        return pac && pacienteAplicaEnMes(pac, cal.mes, cal.anio);
      });
      setCalendarios(calsValidas);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar");
    }
  }, [anio, mes]);

  useEffect(() => {
    loadInicial();
    const unsub = db.calendario_paciente.subscribe(() => {
      db.calendario_paciente.listAll().then(setCalendarios);
    });
    return unsub;
  }, [loadInicial]);

  // Cargar asuetos cuando cambia mes/año
  useEffect(() => {
    const clave = `asuetos_${anio}_${mes}`;
    db.parametro.filter({ clave }).then((res) => {
      setAsuetos(res[0]?.valor ?? "");
    });
  }, [mes, anio]);

  // Recargar horario cuando cambia paciente, mes o año
  useEffect(() => {
    if (!pacienteId || pacientes.length === 0) return;
    const p = pacientes.find((p) => p.id === pacienteId);
    if (!p) return;
    const cal = calendarios.find((c) => c.paciente_id === pacienteId && c.anio === anio && c.mes === mes);
    if (cal) {
      // Merge por día: la ficha (Horario Semanal) es la base; los días que el
      // calendario guardado SÍ tenga capturados mandan (overrides del mes). Así
      // un día que quedó vacío en el calendario guardado (ej. viernes de Frida)
      // se completa desde la ficha en vez de faltar, sin pisar ajustes del mes.
      const horarioMerged: HorarioSemanal = { ...emptyHorario(), ...(p.dias_sesion ?? {}) };
      const tipoMerged: TipoSesionSemanal = { ...emptyTipoSesion(), ...(p.tipo_sesion ?? {}) };
      const terapMerged: HorarioSemanal = { ...emptyHorario(), ...(p.terapeutas ?? {}) };
      DIAS_KEY.forEach((d) => {
        const val = cal.horario?.[d];
        if (val && val.trim()) {
          horarioMerged[d] = val;
          if (cal.tipo_sesion?.[d]) tipoMerged[d] = cal.tipo_sesion[d];
          if (cal.terapeutas?.[d]) terapMerged[d] = cal.terapeutas[d];
        }
      });
      setHorario(horarioMerged);
      setTipoSesion(tipoMerged);
      setTerapeutas(terapMerged);
      setExcepciones(cal.excepciones ?? "");
      setReposiciones(cal.reposiciones ?? []);
      setMontoOverride(cal.monto_override ?? null);
    } else {
      setHorario({ ...emptyHorario(), ...(p.dias_sesion ?? {}) });
      setTipoSesion({ ...emptyTipoSesion(), ...(p.tipo_sesion ?? {}) });
      setTerapeutas({ ...emptyHorario(), ...(p.terapeutas ?? {}) });
      setExcepciones("");
      setReposiciones([]);
      setMontoOverride(null);
    }
  }, [pacienteId, mes, anio, calendarios, pacientes]);

  const onSelectPaciente = (id: string) => {
    setPacienteId(id);
    setPaciente(pacientes.find((p) => p.id === id) ?? null);
  };

  const reposicionesValidas = reposiciones.filter((r) => r.dia && r.hora);
  const reposicionesMap: Record<number, { hora: string; tipoRep: "Regular" | "Matutina" }> = {};
  reposicionesValidas.forEach((r) => {
    reposicionesMap[Number(r.dia)] = { hora: r.hora, tipoRep: r.tipoRep || "Regular" };
  });

  const excepcionesTotales = [excepciones, asuetos].filter(Boolean).join(",");
  const { celdas, totalSesiones } = generarCalendario(anio, mes, horario, excepcionesTotales);
  const montosCalc = calcularMontos(celdas, paciente, params, reposicionesValidas);
  const montoEfectivo = montoOverride !== null ? Number(montoOverride) : montosCalc.montoEfectivo;
  const montoTransferencia = Math.round(montoEfectivo * (1 + Number(params.iva ?? 0.16)));

  const guardarCalendario = async () => {
    if (!pacienteId) return;
    setGuardando(true);
    try {
      let sesReg = 0;
      let sesMat = 0;
      celdas.flat().forEach((c) => {
        if (c.tipo !== "sesion" || c.diaSemana === undefined) return;
        const diaKey = DIAS_KEY[c.diaSemana];
        if ((tipoSesion[diaKey] ?? "Regular") === "Matutina") sesMat++;
        else sesReg++;
      });
      reposicionesValidas.forEach((r) => {
        if (r.tipoRep === "Matutina") sesMat++;
        else sesReg++;
      });
      const data = {
        paciente_id: pacienteId,
        paciente_nombre: paciente?.nombre ?? null,
        anio,
        mes,
        horario,
        tipo_sesion: tipoSesion,
        terapeutas,
        excepciones,
        reposiciones: reposicionesValidas,
        total_sesiones: totalSesiones + reposicionesValidas.length,
        sesiones_regulares: sesReg,
        sesiones_matutinas: sesMat,
        reposiciones_count: reposicionesValidas.length,
        monto_efectivo: montoEfectivo,
        monto_transferencia: montoTransferencia,
        monto_override: montoOverride,
      };
      const existing = await db.calendario_paciente.filter({ paciente_id: pacienteId, anio, mes });
      if (existing.length > 0) {
        await db.calendario_paciente.update(existing[0].id, data);
      } else {
        await db.calendario_paciente.create(data);
      }
      await upsertSesionMensual({
        paciente_id: pacienteId,
        paciente_nombre: paciente?.nombre ?? null,
        anio,
        mes,
        sesiones_matutinas: sesMat,
        sesiones_regulares: sesReg,
        excepciones_dias: excepciones,
        monto_override: montoOverride,
      });
      setGuardadoOk(true);
      toast.success("Calendario guardado");
      setTimeout(() => setGuardadoOk(false), 3000);
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const guardarAsuetos = async () => {
    setGuardandoAsuetos(true);
    try {
      const clave = `asuetos_${anio}_${mes}`;
      const existente = await db.parametro.filter({ clave });
      if (existente.length > 0) {
        await db.parametro.update(existente[0].id, { valor: asuetos });
      } else {
        await db.parametro.create({
          clave,
          valor: asuetos,
          descripcion: `Asuetos ${MESES[mes - 1]} ${anio}`,
          tipo: "texto",
        });
      }
      const calsDelMes = await db.calendario_paciente.filter({ anio, mes });
      const ops = calsDelMes.map((cal) => {
        const excInd = (cal.excepciones || "").split(",").map((d) => d.trim()).filter(Boolean);
        const excAsuetos = asuetos.split(",").map((d) => d.trim()).filter(Boolean);
        const excTotalesStr = [...new Set([...excInd, ...excAsuetos])].join(",");
        const { celdas: c2, totalSesiones: t2 } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, excTotalesStr);
        const repsValidas = (cal.reposiciones || []).filter((r) => r.dia && r.hora);
        const pac = pacientes.find((p) => p.id === cal.paciente_id);
        const precioReg = precioPorSesion(pac, params, "Regular");
        const ivaRate = Number(params.iva ?? 0.16);
        let me = 0;
        c2.flat().forEach((cc) => { if (cc.tipo === "sesion") me += precioReg; });
        repsValidas.forEach(() => { me += precioReg; });
        const mt = Math.round(me * (1 + ivaRate));
        let sR = 0;
        let sM = 0;
        c2.flat().forEach((cc) => {
          if (cc.tipo !== "sesion" || cc.diaSemana === undefined) return;
          const diaKey = DIAS_KEY[cc.diaSemana];
          if ((cal.tipo_sesion?.[diaKey] ?? "Regular") === "Matutina") sM++;
          else sR++;
        });
        repsValidas.forEach((r) => { if (r.tipoRep === "Matutina") sM++; else sR++; });
        return db.calendario_paciente.update(cal.id, {
          total_sesiones: t2 + repsValidas.length,
          sesiones_regulares: sR,
          sesiones_matutinas: sM,
          monto_efectivo: me,
          monto_transferencia: mt,
        }).then(() => upsertSesionMensual({
          paciente_id: cal.paciente_id,
          paciente_nombre: cal.paciente_nombre,
          anio: cal.anio,
          mes: cal.mes,
          sesiones_matutinas: sM,
          sesiones_regulares: sR,
          excepciones_dias: excInd.join(","),
          monto_override: cal.monto_override ?? null,
        }));
      });
      await Promise.all(ops);
      const fresh = await db.calendario_paciente.listAll();
      setCalendarios(fresh);
      toast.success(`Asuetos guardados — ${ops.length} calendarios actualizados`);
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar asuetos");
    } finally {
      setGuardandoAsuetos(false);
    }
  };

  const recalcularTodos = async () => {
    setRecalculando(true);
    try {
      const calsDelMes = await db.calendario_paciente.filter({ anio, mes });
      const asietosParam = await db.parametro.filter({ clave: `asuetos_${anio}_${mes}` });
      const asietosStr = asietosParam[0]?.valor ?? "";
      const allPacs = await db.paciente.listAll("nombre");
      const pacMap = Object.fromEntries(allPacs.map((p) => [p.id, p]));
      const precioGlobal = Number(params.precio_terapia_regular ?? 1100);
      const ivaRate = Number(params.iva ?? 0.16);

      const ops = calsDelMes
        .filter((cal) => (cal.total_sesiones || 0) === 0 && cal.horario && Object.values(cal.horario).some((v) => v))
        .map((cal) => {
          const excTotales = [cal.excepciones || "", asietosStr].filter(Boolean).join(",");
          const { celdas: c2, totalSesiones: t2 } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, excTotales);
          const repsValidas = (cal.reposiciones || []).filter((r) => r.dia && r.hora);
          const pac = pacMap[cal.paciente_id];
          const precioReg = precioPorSesion(pac, params, "Regular");
          let me = 0;
          let sR = 0;
          let sM = 0;
          c2.flat().forEach((cc) => {
            if (cc.tipo !== "sesion" || cc.diaSemana === undefined) return;
            me += precioReg;
            const diaKey = DIAS_KEY[cc.diaSemana];
            if ((cal.tipo_sesion?.[diaKey] ?? "Regular") === "Matutina") sM++;
            else sR++;
          });
          repsValidas.forEach((r) => {
            me += precioReg;
            if (r.tipoRep === "Matutina") sM++;
            else sR++;
          });
          const mt = Math.round(me * (1 + ivaRate));
          return db.calendario_paciente.update(cal.id, {
            total_sesiones: t2 + repsValidas.length,
            sesiones_regulares: sR,
            sesiones_matutinas: sM,
            monto_efectivo: me,
            monto_transferencia: mt,
          }).then(() => upsertSesionMensual({
            paciente_id: cal.paciente_id,
            paciente_nombre: cal.paciente_nombre,
            anio: cal.anio,
            mes: cal.mes,
            sesiones_matutinas: sM,
            sesiones_regulares: sR,
            excepciones_dias: cal.excepciones || "",
            monto_override: cal.monto_override ?? null,
          }));
        });
      await Promise.all(ops);
      const fresh = await db.calendario_paciente.listAll();
      setCalendarios(fresh);
      toast.success(`Recalculados ${ops.length} calendarios con 0 sesiones`);
    } catch (err: any) {
      toast.error(err?.message || "Error al recalcular");
    } finally {
      setRecalculando(false);
    }
  };

  const sincronizarMesConTerapias = async () => {
    if (!confirm(`¿Sincronizar todos los calendarios de ${MESES[mes - 1]} ${anio} con la entidad Terapias?`)) return;
    setSincronizando(true);
    try {
      const calsDelMes = await db.calendario_paciente.filter({ anio, mes });
      await Promise.all(calsDelMes.map((cal) =>
        upsertSesionMensual({
          paciente_id: cal.paciente_id,
          paciente_nombre: cal.paciente_nombre,
          anio: cal.anio,
          mes: cal.mes,
          sesiones_matutinas: cal.sesiones_matutinas || 0,
          sesiones_regulares: cal.sesiones_regulares || 0,
          excepciones_dias: cal.excepciones || "",
          monto_override: cal.monto_override ?? null,
        }),
      ));
      toast.success(`Sincronizados ${calsDelMes.length} calendarios`);
    } catch (err: any) {
      toast.error(err?.message || "Error al sincronizar");
    } finally {
      setSincronizando(false);
    }
  };

  const llenarCalendariosFaltantes = async () => {
    if (!confirm(`¿Generar calendarios faltantes para ${MESES[mes - 1]} ${anio}?`)) return;
    setLlenandoCalendarios(true);
    try {
      // Implementación cliente: para cada paciente activo que aplique en el mes, crea calendario base si no existe.
      const [allPacs, calsExistentes] = await Promise.all([
        db.paciente.filter({ estatus: "Activo" }, "nombre", 500),
        db.calendario_paciente.filter({ anio, mes }),
      ]);
      const existIds = new Set(calsExistentes.map((c) => c.paciente_id));
      const aplicantes = allPacs.filter((p) => pacienteAplicaEnMes(p, mes, anio));
      const faltantes = aplicantes.filter((p) => !existIds.has(p.id));
      const creados: string[] = [];
      for (const p of faltantes) {
        await db.calendario_paciente.create({
          paciente_id: p.id,
          paciente_nombre: p.nombre,
          anio,
          mes,
          horario: { ...emptyHorario(), ...(p.dias_sesion ?? {}) },
          tipo_sesion: { ...emptyTipoSesion(), ...(p.tipo_sesion ?? {}) },
          terapeutas: { ...emptyHorario(), ...(p.terapeutas ?? {}) },
          excepciones: "",
          reposiciones: [],
          total_sesiones: 0,
          sesiones_regulares: 0,
          sesiones_matutinas: 0,
          reposiciones_count: 0,
          monto_efectivo: 0,
          monto_transferencia: 0,
        });
        creados.push(p.nombre);
      }
      const fresh = await db.calendario_paciente.listAll();
      setCalendarios(fresh);
      toast.success(`✓ ${MESES[mes - 1]} ${anio}: creados ${creados.length}, omitidos ${aplicantes.length - faltantes.length}`);
    } catch (err: any) {
      toast.error(err?.message || "Error al llenar calendarios");
    } finally {
      setLlenandoCalendarios(false);
    }
  };

  const limpiarCalendariosHuerfanos = async () => {
    if (!confirm("¿Eliminar calendarios de pacientes que ya no aplican en sus meses guardados?")) return;
    setLimpiando(true);
    try {
      const [allCals, allPacs] = await Promise.all([
        db.calendario_paciente.listAll(),
        db.paciente.listAll("nombre"),
      ]);
      const pacMap = Object.fromEntries(allPacs.map((p) => [p.id, p]));
      const huerfanos = allCals.filter((cal) => {
        const pac = pacMap[cal.paciente_id];
        return !pac || !pacienteAplicaEnMes(pac, cal.mes, cal.anio);
      });
      for (const cal of huerfanos) {
        await db.calendario_paciente.delete(cal.id);
      }
      const fresh = await db.calendario_paciente.listAll();
      setCalendarios(fresh);
      toast.success(huerfanos.length === 0 ? "Sin calendarios huérfanos" : `Eliminados ${huerfanos.length} calendarios huérfanos`);
    } catch (err: any) {
      toast.error(err?.message || "Error al limpiar");
    } finally {
      setLimpiando(false);
    }
  };

  const imprimir = async () => {
    const el = document.getElementById("calendario-print");
    if (!el) return;
    setGenerandoPDF(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(el, { scale: 3, useCORS: true, backgroundColor: "#ffffff", logging: false });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentW = pageW - margin * 2;
      const contentH = (canvas.height * contentW) / canvas.width;
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageW, pageH, "F");
      pdf.addImage(imgData, "PNG", margin, margin, contentW, contentH);
      pdf.setFontSize(7);
      pdf.setTextColor(43, 196, 174);
      pdf.text("Centro Con-sentido — anapaula@centroconsentido.com", pageW / 2, pageH - 5, { align: "center" });
      const nombreLimpio = (paciente?.nombre || "calendario").replace(/\s+/g, "");
      pdf.save(`${nombreLimpio}_${MESES[mes - 1]}${anio}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Error al generar PDF");
    } finally {
      setGenerandoPDF(false);
    }
  };

  const addReposicion = () => setReposiciones((r) => [...r, { dia: 0, hora: "", tipoRep: "Regular" }]);
  const removeReposicion = (i: number) => setReposiciones((r) => r.filter((_, idx) => idx !== i));
  const updateReposicion = (i: number, field: keyof Reposicion, val: any) =>
    setReposiciones((r) => r.map((x, idx) => (idx === i ? { ...x, [field]: val } : x)));

  const mesLabel = MESES[mes - 1];
  const aplicantes = pacientes.filter((p) => pacienteAplicaEnMes(p, mes, anio));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-stone-800">Generador de Calendarios</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {pacienteId && (
            <>
              {guardadoOk && (
                <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                  <CheckCircle size={15} /> Guardado
                </span>
              )}
              <button onClick={guardarCalendario} disabled={guardando}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
                <Save size={16} /> {guardando ? "Guardando..." : "Guardar"}
              </button>
              <button onClick={recalcularTodos} disabled={recalculando}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
                {recalculando ? "Recalculando..." : "Recalcular 0-sesiones"}
              </button>
              <button onClick={sincronizarMesConTerapias} disabled={sincronizando}
                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
                {sincronizando ? "Sincronizando..." : "Sincronizar mes"}
              </button>
              <button onClick={imprimir} disabled={generandoPDF}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
                <Printer size={16} /> {generandoPDF ? "Generando..." : "Imprimir / PDF"}
              </button>
            </>
          )}
          <button onClick={llenarCalendariosFaltantes} disabled={llenandoCalendarios}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
            <Plus size={16} /> {llenandoCalendarios ? "Llenando..." : "Llenar faltantes"}
          </button>
          <button onClick={limpiarCalendariosHuerfanos} disabled={limpiando}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
            <Trash2 size={16} /> {limpiando ? "Limpiando..." : "Limpiar huérfanos"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-6 print:hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-xs font-medium text-stone-500 block mb-1">Paciente</label>
            <select value={pacienteId} onChange={(e) => onSelectPaciente(e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
              <option value="">— Seleccionar paciente —</option>
              {aplicantes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Mes</label>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Año</label>
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-medium text-stone-500 block mb-2">Horario semanal — hora y tipo por día</label>
          <div className="grid grid-cols-7 gap-2">
            {DIAS_KEY.map((d, i) => (
              <div key={d}>
                <p className="text-xs text-center text-stone-400 mb-1">{DIAS_SEMANA[i].substring(0, 3)}</p>
                <input value={horario[d] || ""} onChange={(e) => setHorario({ ...horario, [d]: e.target.value })}
                  placeholder="—"
                  className="w-full border border-stone-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-200 mb-1" />
                <select value={tipoSesion[d] || "Regular"} onChange={(e) => setTipoSesion({ ...tipoSesion, [d]: e.target.value as "Regular" | "Matutina" })}
                  className="w-full border border-stone-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200">
                  <option>Regular</option>
                  <option>Matutina</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-amber-700">🗓 Asuetos / Vacaciones — aplican a TODOS los pacientes este mes</label>
            <button onClick={guardarAsuetos} disabled={guardandoAsuetos}
              className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-medium px-3 py-1 rounded-lg">
              {guardandoAsuetos ? "Guardando..." : "Guardar asuetos"}
            </button>
          </div>
          <input value={asuetos} onChange={(e) => setAsuetos(e.target.value)}
            placeholder="Ej: 1, 5, 15"
            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 bg-white" />
          <p className="text-xs text-amber-600 mt-1">Estos días se excluyen automáticamente al generar o guardar.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Días sin sesión individuales</label>
            <input value={excepciones} onChange={(e) => setExcepciones(e.target.value)}
              placeholder="Ej: 1, 5, 20"
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Fecha de Pago</label>
            <input value={pagado} onChange={(e) => setPagado(e.target.value)}
              placeholder="Ej: PAGADO. Abril 10. 2026."
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-stone-500">Reposiciones (día y hora)</label>
            <button onClick={addReposicion}
              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium border border-violet-200 rounded-lg px-2 py-1 hover:bg-violet-50">
              <Plus size={12} /> Agregar
            </button>
          </div>
          {reposiciones.length === 0 && <p className="text-xs text-stone-400 italic">Sin reposiciones este mes.</p>}
          <div className="flex flex-col gap-2">
            {reposiciones.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-stone-400 w-5">{i + 1}.</span>
                <input type="number" min="1" max="31" value={r.dia || ""}
                  onChange={(e) => updateReposicion(i, "dia", Number(e.target.value))}
                  placeholder="Día"
                  className="w-16 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-green-200" />
                <input value={r.hora} onChange={(e) => updateReposicion(i, "hora", e.target.value)}
                  placeholder="Hora (ej: 10am)"
                  className="flex-1 border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-200" />
                <select value={r.tipoRep || "Regular"} onChange={(e) => updateReposicion(i, "tipoRep", e.target.value)}
                  className="border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-200">
                  <option value="Regular">Regular</option>
                  <option value="Matutina">Matutina</option>
                </select>
                <button onClick={() => removeReposicion(i)} className="text-stone-300 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        {pacienteId && (
          <div className="mt-4 p-3 bg-violet-50 rounded-xl space-y-2">
            <div className="flex flex-wrap gap-4 text-sm items-center">
              <span className="text-stone-600">
                <strong>{totalSesiones + reposicionesValidas.length} sesiones</strong>
                {reposicionesValidas.length > 0 && <span className="text-green-600 ml-1">({reposicionesValidas.length} repos.)</span>}
              </span>
              <span className="text-stone-600">Calculado: <strong className="text-stone-800">{fmtMXN(montoEfectivo)}</strong></span>
              <span className="text-stone-600">Con IVA: <strong className="text-violet-700">{fmtMXN(montoTransferencia)}</strong></span>
            </div>
            <div className="flex items-center gap-3 pt-1 border-t border-violet-200">
              <label className="text-xs font-semibold text-violet-700 whitespace-nowrap">💰 Override monto efectivo:</label>
              <input type="number" min="0" value={montoOverride ?? ""}
                placeholder={`${montoEfectivo} (calculado)`}
                onChange={(e) => setMontoOverride(e.target.value === "" ? null : Number(e.target.value))}
                className="w-36 border border-violet-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white" />
              {montoOverride !== null && (
                <>
                  <span className="text-xs text-stone-500">Con IVA: <strong className="text-violet-700">{fmtMXN(Math.round(Number(montoOverride) * (1 + Number(params.iva ?? 0.16))))}</strong></span>
                  <button onClick={() => setMontoOverride(null)} className="text-xs text-red-400 hover:text-red-600 underline">Quitar override</button>
                </>
              )}
              {montoOverride === null && <span className="text-xs text-stone-400 italic">Edita para fijar un monto diferente al calculado</span>}
            </div>
          </div>
        )}
      </div>

      {pacienteId && (
        <div id="calendario-print" className="bg-white" style={{ fontFamily: "var(--font-nunito), 'Nunito', 'Helvetica Neue', Arial, sans-serif", maxWidth: "100%", padding: "22px 26px", color: "#4b4742" }}>
          {/* Encabezado: logo + datos de contacto */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingBottom: "14px", borderBottom: "3px solid #f0ede9" }}>
            <BrandLogo size={76} />
            <div style={{ textAlign: "right", fontSize: "9px", color: "#9a958d", lineHeight: "1.7", fontWeight: 600 }}>
              <div style={{ color: "#0F7A6A", fontWeight: 700 }}>anapaula@centroconsentido.com</div>
              <div>IG: @centro.consentido &nbsp;·&nbsp; WA: 81-2581-8016</div>
              <div>Rio Colorado 213 Ote, piso 2</div>
              <div>Del Valle, SPGG, 66220</div>
            </div>
          </div>

          {/* Título + pastilla del mes */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ textAlign: "center", fontSize: "14px", fontWeight: 700, color: "#8A8780", marginBottom: "8px", letterSpacing: "2px", textTransform: "uppercase" }}>
              Horario Mensual de Terapias
            </h2>
            <span style={{ display: "inline-block", background: "linear-gradient(135deg, #2BC4AE 0%, #43BCEC 100%)", color: "white", borderRadius: "50px", padding: "9px 50px", fontSize: "24px", fontWeight: 800, letterSpacing: "2px", boxShadow: "0 4px 14px rgba(43,196,174,0.35)" }}>
              {mesLabel.toUpperCase()} {anio}
            </span>
          </div>

          {/* Datos del paciente + nota */}
          <div style={{ display: "flex", gap: "14px", marginBottom: "14px", alignItems: "stretch" }}>
            <div style={{ flex: 1, fontSize: "12px", lineHeight: 2, background: "#DCF6F1", borderRadius: "12px", padding: "12px 16px", border: "1.5px solid #A6E6DC" }}>
              <div><span style={{ fontWeight: 800, color: "#0F7A6A" }}>Nombre:</span> <span style={{ fontWeight: 600, color: "#3a3a3a" }}>{paciente?.nombre}</span></div>
              <div><span style={{ fontWeight: 800, color: "#0F7A6A" }}>Tipo de Terapia:</span> <span style={{ fontWeight: 600, color: "#3a3a3a" }}>{paciente?.tipo_terapia || "Terapia Ocupacional"}</span></div>
            </div>
            <div style={{ flex: 1.2, border: "1.5px solid #F8C6D2", borderRadius: "12px", padding: "11px 14px", fontSize: "8.5px", color: "#B8284A", fontWeight: 600, lineHeight: 1.55, background: "#FDEAEF" }}>
              <strong style={{ letterSpacing: "0.5px" }}>NOTA:</strong> Se permite realizar una cancelación al mes, siempre y cuando se notifique con anticipación antes de la fecha establecida para tales avisos, a fin de procesar el descuento correspondiente. Pasada esta fecha límite, no se autorizarán descuentos. En caso de imposibilidad de asistencia, nos complace buscar la reposición de la sesión, sujeto a la disponibilidad de nuestra agenda. En caso de no lograr reprogramar la sesión, no se aplicará el descuento correspondiente. Les recordamos que la constancia en las sesiones terapéuticas es clave para asegurar el progreso del paciente.
            </div>
          </div>

          {/* Calendario */}
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, marginBottom: "12px", fontSize: "10px", borderRadius: "12px", overflow: "hidden", boxShadow: "0 2px 10px rgba(43,196,174,0.12)", border: "1.5px solid #DCF6F1" }}>
            <thead>
              <tr>
                {["Lunes", "Martes", "Miérc.", "Jueves", "Viernes", "Sábado", "Domingo"].map((d) => (
                  <th key={d} style={{ background: "linear-gradient(135deg, #2BC4AE 0%, #1aa491 100%)", color: "white", fontWeight: 700, padding: "10px 2px", textAlign: "center", fontSize: "11px", letterSpacing: "0.5px", textTransform: "uppercase" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {celdas.map((semana, fi) => (
                <tr key={fi}>
                  {semana.map((celda, ci) => (
                    <td key={ci} style={{ border: "1px solid #eef0ee", height: "62px", verticalAlign: "top", padding: "5px 3px", background: celda.dia === null ? "#f8f7f4" : "white", width: "14.28%" }}>
                      {celda.dia !== null && (() => {
                        const repoData = reposicionesMap[celda.dia];
                        const esReposicion = !!repoData;
                        return (
                          <>
                            <span style={{ color: "#a6a299", fontSize: "10px", fontWeight: 800 }}>{celda.dia}</span>
                            {esReposicion && (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "2px", gap: "2px" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#5DC97B", color: "white", borderRadius: "7px", height: "17px", fontSize: "9px", fontWeight: 800, width: "100%", boxSizing: "border-box", lineHeight: 1 }}>
                                  {repoData.hora}
                                </div>
                                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "7.5px", color: "white", fontWeight: 800, background: "#1E7C42", borderRadius: "5px", padding: "2px 6px", letterSpacing: "0.5px", lineHeight: 1 }}>REP</span>
                                {repoData.tipoRep === "Matutina" && (
                                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "7.5px", color: "white", fontWeight: 800, background: "#B5790E", borderRadius: "5px", padding: "2px 6px", letterSpacing: "0.5px", lineHeight: 1 }}>MAT</span>
                                )}
                              </div>
                            )}
                            {!esReposicion && celda.tipo === "sesion" && celda.diaSemana !== undefined && (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "2px", gap: "2px" }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#2BC4AE", color: "white", borderRadius: "7px", height: "17px", fontSize: "9px", fontWeight: 800, width: "100%", boxSizing: "border-box", lineHeight: 1 }}>
                                  {celda.hora}
                                </div>
                                {(tipoSesion[DIAS_KEY[celda.diaSemana]] ?? "Regular") === "Matutina" && (
                                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "7.5px", color: "white", fontWeight: 800, background: "#B5790E", borderRadius: "5px", padding: "2px 6px", letterSpacing: "0.5px", lineHeight: 1 }}>MAT</span>
                                )}
                              </div>
                            )}
                            {!esReposicion && celda.tipo === "excepcion" && (
                              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginTop: "5px" }}>
                                <div style={{ background: "#F0567A", borderRadius: "50%", width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <span style={{ color: "white", fontWeight: 900, fontSize: "15px", lineHeight: 1 }}>✕</span>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Leyenda */}
          <div style={{ display: "flex", gap: "18px", marginBottom: "12px", fontSize: "9.5px", alignItems: "center", background: "#f8f7f4", borderRadius: "10px", padding: "8px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "14px", height: "14px", borderRadius: "5px", background: "#2BC4AE" }}></div>
              <span style={{ color: "#4b4742", fontWeight: 700 }}>Sesión regular</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "14px", height: "14px", borderRadius: "5px", background: "#5DC97B" }}></div>
              <span style={{ color: "#4b4742", fontWeight: 700 }}>Reposición</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "14px", height: "14px", borderRadius: "5px", background: "#B5790E" }}></div>
              <span style={{ color: "#4b4742", fontWeight: 700 }}>Matutina (MAT)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#F0567A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "white", fontWeight: 900, fontSize: "9px", lineHeight: 1 }}>✕</span>
              </div>
              <span style={{ color: "#4b4742", fontWeight: 700 }}>Día sin sesión</span>
            </div>
          </div>

          {/* Resumen */}
          <div style={{ fontSize: "10.5px", lineHeight: 1.85, background: "#EFE6FB", borderRadius: "14px", padding: "13px 18px", border: "1.5px solid #D6BEF4" }}>
            <div style={{ fontWeight: 800, color: "#6B36B8", borderBottom: "1.5px solid #D6BEF4", paddingBottom: "7px", marginBottom: "7px" }}>
              Número de Sesiones: <span style={{ fontWeight: 600, color: "#4b4742" }}>{totalSesiones} sesiones{reposicionesValidas.length > 0 ? ` + ${reposicionesValidas.length} reposición(es)` : ""} = {totalSesiones + reposicionesValidas.length} en total</span>
            </div>
            <div style={{ fontWeight: 600, color: "#3a3a3a" }}>
              <span style={{ fontWeight: 800, color: "#6B36B8" }}>Monto Total del Mes:</span>{" "}
              Pago en Efectivo: {fmtMXN(montoEfectivo)} pesos &nbsp;|&nbsp; Pago en Tarjeta/transferencia/depósito + IVA: {fmtMXN(montoTransferencia)}
            </div>
            <div style={{ fontSize: "9px", fontStyle: "italic", color: "#8A8780", marginTop: "7px", lineHeight: 1.6, borderTop: "1.5px solid #D6BEF4", paddingTop: "7px" }}>
              *El pago se debe cubrir antes del día <strong>{params.dia_tope_pago ?? 10}</strong> del mes.
              De lo contrario se aplicará un recargo del {((Number(params.recargo_pago_tarde ?? 0.10)) * 100).toFixed(0)}%.
            </div>
            {pagado && (
              <div style={{ marginTop: "7px", fontWeight: 800, color: "#6B36B8" }}>
                Pagado: <span style={{ background: "#E2F6E8", color: "#1E7C42", padding: "2px 12px", borderRadius: "7px", fontWeight: 800, border: "1.5px solid #B2E6C2" }}>{pagado}</span>
              </div>
            )}
          </div>

          {/* Pie */}
          <div style={{ textAlign: "center", marginTop: "14px", fontSize: "8.5px", fontWeight: 700, color: "#b8b3aa", letterSpacing: "0.5px" }}>
            Centro Con-sentido · Terapia infantil con sentido
          </div>
        </div>
      )}

      {!pacienteId && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <div className="w-12 h-12 bg-violet-100 rounded-xl mx-auto mb-3 flex items-center justify-center">
            <Printer size={24} className="text-violet-400" />
          </div>
          <p className="text-stone-400 text-sm">Selecciona un paciente para generar su calendario mensual</p>
        </div>
      )}
    </div>
  );
}
