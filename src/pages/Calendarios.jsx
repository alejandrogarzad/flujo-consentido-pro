import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { generarCalendario, fmtMXN, MESES, paramsToObject, DIAS_SEMANA, pacienteAplicaEnMes } from "@/lib/calculos";
import { Printer, Plus, Trash2, Save, CheckCircle } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const DIAS_KEY = ["lunes","martes","miercoles","jueves","viernes","sabado","domingo"];

// Genera resumen de montos considerando sesiones mixtas por día y reposiciones
function calcularMontos(celdas, horario, tipoSesion, paciente, params, reposicionesValidas) {
  const ivaRate = Number(params.iva || 0.16);

  const precioGlobal = Number(params.precio_terapia_regular || 1100);
  const precioPorSesion = Number(paciente?.precio_sesion_regular) || precioGlobal;

  let montoEfectivo = 0;

  celdas.flat().forEach(celda => {
    if (celda.tipo !== "sesion") return;
    montoEfectivo += precioPorSesion;
  });

  // Sumar reposiciones
  (reposicionesValidas || []).forEach(() => {
    montoEfectivo += precioPorSesion;
  });

  const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));

  return { montoEfectivo, montoTransferencia };
}

// Helper: sincroniza SesionMensual con los totales del calendario
async function upsertSesionMensual({ paciente_id, paciente_nombre, anio, mes, sesiones_matutinas, sesiones_regulares, excepciones_dias, monto_override }) {
  const existing = await base44.entities.SesionMensual.filter({ paciente_id, anio, mes });
  if (existing.length > 0) {
    await base44.entities.SesionMensual.update(existing[0].id, {
      sesiones_matutinas,
      sesiones_regulares,
      paciente_nombre,
      excepciones_dias: excepciones_dias || "",
      monto_override: monto_override !== undefined ? monto_override : null,
    });
  } else {
    await base44.entities.SesionMensual.create({
      paciente_id,
      paciente_nombre,
      anio,
      mes,
      sesiones_matutinas,
      sesiones_regulares,
      excepciones_dias: excepciones_dias || "",
      monto_override: monto_override !== undefined ? monto_override : null,
      beca_porcentaje: 0,
      forma_pago_mes: "Efectivo",
    });
  }
}

export default function Calendarios() {
  const [pacientes, setPacientes] = useState([]);
  const [params, setParams] = useState({});
  const [pacienteId, setPacienteId] = useState("");
  const [paciente, setPaciente] = useState(null);
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [horario, setHorario] = useState({ lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" });
  const [tipoSesion, setTipoSesion] = useState({ lunes:"Regular", martes:"Regular", miercoles:"Regular", jueves:"Regular", viernes:"Regular", sabado:"Regular", domingo:"Regular" });
  const [terapeutas, setTerapeutas] = useState({ lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" });
  const [excepciones, setExcepciones] = useState("");
  const [pagado, setPagado] = useState("");
  const [asuetos, setAsuetos] = useState("");
  const [guardandoAsuetos, setGuardandoAsuetos] = useState(false);
  // Reposiciones: array de { dia: number, hora: string }
  const [reposiciones, setReposiciones] = useState([]);
  const printRef = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const guardarCalendario = async () => {
    if (!pacienteId) return;
    setGuardando(true);
    const excTotales = [excepciones, asuetos].filter(Boolean).join(",");
    const { celdas, totalSesiones } = generarCalendario(anio, mes, horario, excTotales);
    const reposicionesValidas = reposiciones.filter(r => r.dia && r.hora);
    const montos = calcularMontos(celdas, horario, tipoSesion, paciente, params, reposicionesValidas);
    // Si hay override manual, usarlo; sino usar el calculado
    const montoEfectivo = montoOverride !== null ? Number(montoOverride) : montos.montoEfectivo;
    const ivaRate = Number(params.iva || 0.16);
    const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));
    let sesReg = 0, sesMat = 0;
    celdas.flat().forEach(c => {
      if (c.tipo !== "sesion") return;
      const diaKey = DIAS_KEY[c.diaSemana];
      if ((tipoSesion?.[diaKey] || "Regular") === "Matutina") sesMat++; else sesReg++;
    });
    reposicionesValidas.forEach(r => { if (r.tipoRep === "Matutina") sesMat++; else sesReg++; });
    const data = {
      paciente_id: pacienteId, paciente_nombre: paciente?.nombre,
      anio, mes, horario, tipo_sesion: tipoSesion, terapeutas,
      excepciones, reposiciones: reposicionesValidas,
      total_sesiones: totalSesiones + reposicionesValidas.length,
      sesiones_regulares: sesReg, sesiones_matutinas: sesMat,
      reposiciones_count: reposicionesValidas.length,
      monto_efectivo: montoEfectivo, monto_transferencia: montoTransferencia,
      monto_override: montoOverride !== null ? montoOverride : null,
    };
    const existing = await base44.entities.CalendarioPaciente.filter({ paciente_id: pacienteId, anio, mes });
    if (existing.length > 0) {
      await base44.entities.CalendarioPaciente.update(existing[0].id, data);
    } else {
      await base44.entities.CalendarioPaciente.create(data);
    }
    await upsertSesionMensual({ paciente_id: pacienteId, paciente_nombre: paciente?.nombre, anio, mes, sesiones_matutinas: sesMat, sesiones_regulares: sesReg, excepciones_dias: excepciones, monto_override: montoOverride !== null ? Number(montoOverride) : null });
    setGuardando(false);
    setGuardadoOk(true);
    setTimeout(() => setGuardadoOk(false), 3000);
  };

  // Recalcular todos los calendarios del mes que tengan 0 sesiones
  const recalcularTodos = async () => {
    setRecalculando(true);
    const calsDelMes = await base44.entities.CalendarioPaciente.filter({ anio, mes });
    const asietosParam = await base44.entities.Parametro.filter({ clave: `asuetos_${anio}_${mes}` });
    const asietosStr = asietosParam[0]?.valor || "";
    const allPacs = await base44.entities.Paciente.list("nombre", 500);
    const pacMap = Object.fromEntries(allPacs.map(p => [p.id, p]));
    const precioGlobal = Number(params.precio_terapia_regular || 1100);
    const ivaRate = Number(params.iva || 0.16);

    const ops = calsDelMes
      .filter(cal => (cal.total_sesiones || 0) === 0 && cal.horario && Object.values(cal.horario).some(v => v))
      .map(cal => {
        const excTotales = [cal.excepciones || "", asietosStr].filter(Boolean).join(",");
        const { celdas, totalSesiones } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, excTotales);
        const reposicionesValidas = (cal.reposiciones || []).filter(r => r.dia && r.hora);
        const pac = pacMap[cal.paciente_id];
        const precioPorSesion = Number(pac?.precio_sesion_regular) || precioGlobal;
        let montoEfectivo = 0;
        let sesReg = 0, sesMat = 0;
        celdas.flat().forEach(c => {
          if (c.tipo !== "sesion") return;
          montoEfectivo += precioPorSesion;
          const diaKey = DIAS_KEY[c.diaSemana];
          if ((cal.tipo_sesion?.[diaKey] || "Regular") === "Matutina") sesMat++; else sesReg++;
        });
        reposicionesValidas.forEach(r => {
          montoEfectivo += precioPorSesion;
          if (r.tipoRep === "Matutina") sesMat++; else sesReg++;
        });
        const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));
        return base44.entities.CalendarioPaciente.update(cal.id, {
          total_sesiones: totalSesiones + reposicionesValidas.length,
          sesiones_regulares: sesReg,
          sesiones_matutinas: sesMat,
          monto_efectivo: montoEfectivo,
          monto_transferencia: montoTransferencia,
        }).then(() => upsertSesionMensual({
          paciente_id: cal.paciente_id,
          paciente_nombre: cal.paciente_nombre,
          anio: cal.anio,
          mes: cal.mes,
          sesiones_matutinas: sesMat,
          sesiones_regulares: sesReg,
          excepciones_dias: cal.excepciones || "",
          monto_override: cal.monto_override != null ? cal.monto_override : null,
        }));
      });
    await Promise.all(ops);
    base44.entities.CalendarioPaciente.list().then(setCalendarios);
    setRecalculando(false);
    alert(`Recalculados ${ops.length} calendarios con 0 sesiones`);
  };

  const addReposicion = () => setReposiciones(r => [...r, { dia: "", hora: "", tipoRep: "Regular" }]);
  const removeReposicion = (i) => setReposiciones(r => r.filter((_, idx) => idx !== i));
  const updateReposicion = (i, field, val) => setReposiciones(r => r.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

  // Reposiciones válidas (con dia y hora)
  const reposicionesValidas = reposiciones.filter(r => r.dia && r.hora);
  // Map de día -> {hora, tipoRep}
  const reposicionesMap = {};
  reposicionesValidas.forEach(r => {
    reposicionesMap[Number(r.dia)] = { hora: r.hora, tipoRep: r.tipoRep || "Regular" };
  });

  const [calendarios, setCalendarios] = useState([]);
  const [montoOverride, setMontoOverride] = useState(null); // null = usar calculado
  const [recalculando, setRecalculando] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Paciente.filter({ estatus: "Activo" }, "nombre", 500), // Solo activos
      base44.entities.Parametro.list(),
      base44.entities.CalendarioPaciente.list(),
    ]).then(([p, par, cals]) => {
      const parObj = paramsToObject(par);
      const claveAsuetos = `asuetos_${anio}_${mes}`;
      setAsuetos(parObj[claveAsuetos] || "");
      const pacientesConCal = new Set(cals.map(c => c.paciente_id));
      // Deduplicar por nombre: quedarse con el que tenga calendario, o el que tenga más datos (mes_inicio)
      const map = new Map();
      p.forEach(pac => {
        const key = pac.nombre.toLowerCase().trim();
        const existing = map.get(key);
        if (!existing) {
          map.set(key, pac);
        } else {
          // Preferir el que tiene calendario
          const hasCalPac = pacientesConCal.has(pac.id);
          const hasCalExisting = pacientesConCal.has(existing.id);
          if (hasCalPac && !hasCalExisting) {
            map.set(key, pac);
          } else if (!hasCalExisting && !hasCalPac) {
            // Si ninguno tiene calendario, preferir el que tiene mes_inicio definido
            if (pac.mes_inicio && !existing.mes_inicio) {
              map.set(key, pac);
            }
          }
        }
      });
      // Convertir a array y ordenar alfabéticamente
      const unique = Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPacientes(unique); 
      setParams(paramsToObject(par));
      // Filtrar calendarios huérfanos: solo los cuyo paciente aplica en ese mes/año
      const pacMap = Object.fromEntries(p.map(pac => [pac.id, pac]));
      const calsValidas = cals.filter(cal => {
        const pac = pacMap[cal.paciente_id];
        return pac && pacienteAplicaEnMes(pac, cal.mes, cal.anio);
      });
      setCalendarios(calsValidas);
    });
  }, []);

  // Cargar asuetos cuando cambia mes/año
  useEffect(() => {
    const clave = `asuetos_${anio}_${mes}`;
    base44.entities.Parametro.filter({ clave }).then(res => {
      setAsuetos(res[0]?.valor || "");
    });
  }, [mes, anio]);

  const guardarAsuetos = async () => {
    setGuardandoAsuetos(true);
    const clave = `asuetos_${anio}_${mes}`;
    // 1. Guardar el parámetro de asuetos
    const existente = await base44.entities.Parametro.filter({ clave });
    if (existente.length > 0) {
      await base44.entities.Parametro.update(existente[0].id, { valor: asuetos });
    } else {
      await base44.entities.Parametro.create({ clave, valor: asuetos, descripcion: `Asuetos ${MESES[mes-1]} ${anio}`, tipo: "texto" });
    }

    // 2. Actualizar todos los calendarios del mes con los nuevos asuetos
    const calsDelMes = await base44.entities.CalendarioPaciente.filter({ anio, mes });
    const ops = calsDelMes.map(cal => {
      // Recalcular excepciones: excepciones individuales del cal + nuevos asuetos
      const excInd = (cal.excepciones || "").split(",").map(d => d.trim()).filter(Boolean);
      const excAsuetos = asuetos.split(",").map(d => d.trim()).filter(Boolean);
      // Unir sin duplicados
      const excTotalesArr = [...new Set([...excInd, ...excAsuetos])];
      const excTotalesStr = excTotalesArr.join(",");

      const { celdas, totalSesiones } = generarCalendario(cal.anio, cal.mes, cal.horario || {}, excTotalesStr);
      const reposicionesValidas = (cal.reposiciones || []).filter(r => r.dia && r.hora);

      // Buscar paciente para obtener precio
      const pac = pacientes.find(p => p.id === cal.paciente_id);
      const precioGlobal = Number(params.precio_terapia_regular || 1100);
      const precioPorSesion = Number(pac?.precio_sesion_regular) || precioGlobal;
      const ivaRate = Number(params.iva || 0.16);

      let montoEfectivo = 0;
      celdas.flat().forEach(c => { if (c.tipo === "sesion") montoEfectivo += precioPorSesion; });
      reposicionesValidas.forEach(() => { montoEfectivo += precioPorSesion; });
      const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));

      let sesReg = 0, sesMat = 0;
      celdas.flat().forEach(c => {
        if (c.tipo !== "sesion") return;
        const diaKey = DIAS_KEY[c.diaSemana];
        if ((cal.tipo_sesion?.[diaKey] || "Regular") === "Matutina") sesMat++; else sesReg++;
      });
      reposicionesValidas.forEach(r => { if (r.tipoRep === "Matutina") sesMat++; else sesReg++; });

      return base44.entities.CalendarioPaciente.update(cal.id, {
        // Guardamos solo las excepciones individuales (sin asuetos) en el campo excepciones
        // Los asuetos se aplican dinámicamente al generar
        total_sesiones: totalSesiones + reposicionesValidas.length,
        sesiones_regulares: sesReg,
        sesiones_matutinas: sesMat,
        monto_efectivo: montoEfectivo,
        monto_transferencia: montoTransferencia,
      }).then(() => upsertSesionMensual({
        paciente_id: cal.paciente_id,
        paciente_nombre: cal.paciente_nombre,
        anio: cal.anio,
        mes: cal.mes,
        sesiones_matutinas: sesMat,
        sesiones_regulares: sesReg,
        excepciones_dias: excInd.join(","),
        monto_override: cal.monto_override != null ? cal.monto_override : null,
      }));
    });
    await Promise.all(ops);
    // Recargar calendarios
    base44.entities.CalendarioPaciente.list().then(setCalendarios);
    setGuardandoAsuetos(false);
  };

  // Recargar calendario cuando cambia paciente, mes o año
  useEffect(() => {
    if (!pacienteId || pacientes.length === 0) return;
    const p = pacientes.find(p => p.id === pacienteId);
    if (!p) return;
    
    const cal = calendarios.find(c => c.paciente_id === pacienteId && c.anio === anio && c.mes === mes);
    
    if (cal) {
      // Cargar desde calendario guardado
      setHorario(cal.horario || { lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" });
      setTipoSesion(cal.tipo_sesion || { lunes:"Regular", martes:"Regular", miercoles:"Regular", jueves:"Regular", viernes:"Regular", sabado:"Regular", domingo:"Regular" });
      setTerapeutas(cal.terapeutas || { lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" });
      setExcepciones(cal.excepciones || "");
      setReposiciones(cal.reposiciones || []);
      // Restaurar override si estaba guardado
      setMontoOverride(cal.monto_override != null ? cal.monto_override : null);
    } else {
      // Cargar desde datos del paciente
      const newHorario = { lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" };
      const newTipoSesion = { lunes:"Regular", martes:"Regular", miercoles:"Regular", jueves:"Regular", viernes:"Regular", sabado:"Regular", domingo:"Regular" };
      const newTerapeutas = { lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" };
      
      if (p.dias_sesion) {
        Object.assign(newHorario, p.dias_sesion);
      }
      if (p.tipo_sesion) {
        Object.assign(newTipoSesion, p.tipo_sesion);
      }
      if (p.terapeutas) {
        Object.assign(newTerapeutas, p.terapeutas);
      }
      
      setHorario(newHorario);
      setTipoSesion(newTipoSesion);
      setTerapeutas(newTerapeutas);
      setExcepciones("");
      setReposiciones([]);
    }
  }, [pacienteId, mes, anio, calendarios, pacientes]);

  // Suscribirse a cambios en tiempo real
  useEffect(() => {
    const unsub = base44.entities.CalendarioPaciente.subscribe(() => {
      base44.entities.CalendarioPaciente.list().then(setCalendarios);
    });
    return unsub;
  }, []);

  const onSelectPaciente = (id) => {
    const p = pacientes.find(p => p.id === id);
    setPacienteId(id);
    setPaciente(p);
  };

  // Combinar excepciones individuales + asuetos globales
  const excepcionesTotales = [excepciones, asuetos].filter(Boolean).join(",");

  const { celdas, totalSesiones } = generarCalendario(anio, mes, horario, excepcionesTotales);
  const montosCalc = calcularMontos(celdas, horario, tipoSesion, paciente, params, reposicionesValidas);
  const montoEfectivo = montoOverride !== null ? Number(montoOverride) : montosCalc.montoEfectivo;
  const montoTransferencia = Math.round(montoEfectivo * (1 + Number(params.iva || 0.16)));



  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [llenandoCalendarios, setLlenandoCalendarios] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const sincronizarMesConTerapias = async () => {
    if (!confirm(`¿Sincronizar todos los calendarios de ${MESES[mes-1]} ${anio} con la entidad Terapias?\n\nEsto actualizará sesiones_regulares, sesiones_matutinas y monto_override en SesionMensual sin recalcular nada.`)) return;
    setSincronizando(true);
    const calsDelMes = await base44.entities.CalendarioPaciente.filter({ anio, mes });
    await Promise.all(calsDelMes.map(cal =>
      upsertSesionMensual({
        paciente_id: cal.paciente_id,
        paciente_nombre: cal.paciente_nombre,
        anio: cal.anio,
        mes: cal.mes,
        sesiones_matutinas: cal.sesiones_matutinas || 0,
        sesiones_regulares: cal.sesiones_regulares || 0,
        excepciones_dias: cal.excepciones || "",
        monto_override: cal.monto_override != null ? cal.monto_override : null,
      })
    ));
    setSincronizando(false);
    alert(`✓ Sincronizados ${calsDelMes.length} calendarios de ${MESES[mes-1]} ${anio} con Terapias.`);
  };

  const llenarCalendariosFaltantes = async () => {
    if (!confirm(`¿Generar calendarios faltantes para ${MESES[mes-1]} ${anio}?\n\nSolo creará calendarios para pacientes activos que NO tengan uno guardado.`)) return;
    setLlenandoCalendarios(true);
    try {
      const res = await base44.functions.invoke('llenarCalendariosFaltantes', { mes, anio });
      const data = res.data;
      if (data.success) {
        const msg = `✓ ${MESES[mes-1]} ${anio}:\n\nCreados: ${data.creados}\nOmitidos: ${data.omitidos}\nTotal revisados: ${data.total_revisados}\n\nPacientes nuevos:\n${data.pacientes_creados.join('\n')}`;
        alert(msg);
        // Recargar calendarios
        base44.entities.CalendarioPaciente.list().then(setCalendarios);
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
      }
    } catch (err) {
      alert('Error al llenar calendarios: ' + err.message);
    } finally {
      setLlenandoCalendarios(false);
    }
  };

  const limpiarCalendariosHuerfanos = async () => {
    if (!confirm('¿Eliminar calendarios de pacientes que ya no aplican en sus meses guardados?\n\nEsto incluye pacientes con fecha de alta anterior.')) return;
    setLimpiando(true);
    try {
      const res = await base44.functions.invoke('limpiarCalendariosHuerfanos', {});
      const data = res.data;
      if (data.success) {
        const msg = data.eliminados === 0
          ? `✓ No hay calendarios huérfanos.`
          : `✓ Eliminados ${data.eliminados} calendarios huérfanos.\n\nPacientes afectados:\n${data.calendarios_huerfanos.map(c => `${c.paciente_nombre} (${c.mes}/${c.anio})`).join('\n')}`;
        alert(msg);
        // Recargar calendarios
        base44.entities.CalendarioPaciente.list().then(setCalendarios);
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
      }
    } catch (err) {
      alert('Error al limpiar calendarios: ' + err.message);
    } finally {
      setLimpiando(false);
    }
  };

  const imprimir = async () => {
    const el = document.getElementById("calendario-print");
    if (!el) return;
    setGenerandoPDF(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

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
      // Footer
      pdf.setFontSize(7);
      pdf.setTextColor(160, 130, 210);
      pdf.text("Centro Con-sentido — anapaula@centroconsentido.com", pageW / 2, pageH - 5, { align: "center" });

      const nombreLimpio = (paciente?.nombre || "calendario").replace(/\s+/g, "");
      const mesStr = MESES[mes - 1];
      pdf.save(`${nombreLimpio}_${mesStr}${anio}.pdf`);
    } finally {
      setGenerandoPDF(false);
    }
  };
  const mesLabel = MESES[mes - 1];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
         <h1 className="text-2xl font-bold text-stone-800">Generador de Calendarios</h1>
         <div className="flex items-center gap-2">
           {pacienteId && (
             <>
               {guardadoOk && (
                 <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                   <CheckCircle size={15} /> Calendario guardado
                 </span>
               )}
               <button onClick={guardarCalendario} disabled={guardando}
                 className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                 <Save size={16} /> {guardando ? "Guardando..." : "Guardar Calendario"}
               </button>
               <button onClick={recalcularTodos} disabled={recalculando}
                 className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                 {recalculando ? "Recalculando..." : "Recalcular 0-sesiones"}
               </button>
               <button onClick={sincronizarMesConTerapias} disabled={sincronizando}
                 className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                 {sincronizando ? "Sincronizando..." : "Sincronizar mes con Terapias"}
               </button>
               <button onClick={imprimir} disabled={generandoPDF} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
                 <Printer size={16} /> {generandoPDF ? "Generando PDF..." : "Imprimir / PDF"}
               </button>
             </>
           )}
           <button onClick={llenarCalendariosFaltantes} disabled={llenandoCalendarios}
             className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
             title={`Generar calendarios faltantes para ${MESES[mes-1]} ${anio}`}>
             <Plus size={16} /> {llenandoCalendarios ? "Llenando..." : "Llenar faltantes"}
           </button>
           <button onClick={limpiarCalendariosHuerfanos} disabled={limpiando}
             className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
             title="Eliminar calendarios de pacientes que ya no aplican">
             <Trash2 size={16} /> {limpiando ? "Limpiando..." : "Limpiar huérfanos"}
           </button>
         </div>
       </div>

      {/* Controles */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-6 print:hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-xs font-medium text-stone-500 block mb-1">Paciente</label>
            <select value={pacienteId} onChange={e => onSelectPaciente(e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
              <option value="">— Seleccionar paciente —</option>
              {pacientes.filter(p => pacienteAplicaEnMes(p, mes, anio)).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Mes</label>
            <select value={mes} onChange={e => setMes(Number(e.target.value))}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
              {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Año</label>
            <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
        </div>

        {/* Horario semanal con tipo por día */}
        <div className="mb-4">
          <label className="text-xs font-medium text-stone-500 block mb-2">Horario semanal — hora y tipo por día</label>
          <div className="grid grid-cols-7 gap-2">
            {DIAS_KEY.map((d, i) => (
              <div key={d}>
                <p className="text-xs text-center text-stone-400 mb-1">{DIAS_SEMANA[i].substring(0,3)}</p>
                <input value={horario[d] || ""} onChange={e => setHorario({...horario, [d]: e.target.value})}
                  placeholder="—"
                  className="w-full border border-stone-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-200 mb-1" />
                <select value={tipoSesion[d] || "Regular"} onChange={e => setTipoSesion({...tipoSesion, [d]: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200">
                  <option>Regular</option>
                  <option>Matutina</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Asuetos globales */}
        <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-amber-700">🗓 Asuetos / Vacaciones — aplican a TODOS los pacientes este mes</label>
            <button onClick={guardarAsuetos} disabled={guardandoAsuetos}
              className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-medium px-3 py-1 rounded-lg transition-colors">
              {guardandoAsuetos ? "Guardando..." : "Guardar asuetos"}
            </button>
          </div>
          <input value={asuetos} onChange={e => setAsuetos(e.target.value)}
            placeholder="Ej: 1, 5, 15 (días del mes separados por coma)"
            className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 bg-white" />
          <p className="text-xs text-amber-600 mt-1">Estos días se excluyen automáticamente de todos los calendarios al generar o guardar.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Días sin sesión individuales (ej: 1, 3, 17)</label>
            <input value={excepciones} onChange={e => setExcepciones(e.target.value)}
              placeholder="Ej: 1, 5, 20"
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Fecha de Pago (para el calendario)</label>
            <input value={pagado} onChange={e => setPagado(e.target.value)}
              placeholder="Ej: PAGADO. Abril 10. 2026."
              className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
        </div>

        {/* Reposiciones */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-stone-500">Reposiciones (día y hora)</label>
            <button onClick={addReposicion}
              className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium border border-violet-200 rounded-lg px-2 py-1 hover:bg-violet-50 transition-colors">
              <Plus size={12} /> Agregar reposición
            </button>
          </div>
          {reposiciones.length === 0 && (
            <p className="text-xs text-stone-400 italic">Sin reposiciones este mes. Se mostrarán en verde en el calendario.</p>
          )}
          <div className="flex flex-col gap-2">
            {reposiciones.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-stone-400 w-5">{i + 1}.</span>
                <input
                  type="number" min="1" max="31"
                  value={r.dia} onChange={e => updateReposicion(i, "dia", e.target.value)}
                  placeholder="Día"
                  className="w-16 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-green-200"
                />
                <input
                  value={r.hora} onChange={e => updateReposicion(i, "hora", e.target.value)}
                  placeholder="Hora (ej: 10am)"
                  className="flex-1 border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-200"
                />
                <select
                  value={r.tipoRep || "Regular"} onChange={e => updateReposicion(i, "tipoRep", e.target.value)}
                  className="border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-200"
                >
                  <option value="Regular">Regular</option>
                  <option value="Matutina">Matutina</option>
                </select>
                <button onClick={() => removeReposicion(i)} className="text-stone-300 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Preview de montos + override manual */}
        {pacienteId && (
          <div className="mt-4 p-3 bg-violet-50 rounded-xl space-y-2">
            <div className="flex flex-wrap gap-4 text-sm items-center">
              <span className="text-stone-600">
                <strong>{totalSesiones + reposicionesValidas.length} sesiones</strong>
                {reposicionesValidas.length > 0 && <span className="text-green-600 ml-1">({reposicionesValidas.length} repos.)</span>}
              </span>
              <span className="text-stone-600">
                Calculado: <strong className="text-stone-800">{fmtMXN(montoEfectivo)}</strong>
              </span>
              <span className="text-stone-600">
                Con IVA: <strong className="text-violet-700">{fmtMXN(montoTransferencia)}</strong>
              </span>
            </div>
            {/* Override manual de monto */}
            <div className="flex items-center gap-3 pt-1 border-t border-violet-200">
              <label className="text-xs font-semibold text-violet-700 whitespace-nowrap">💰 Override monto efectivo:</label>
              <input
                type="number"
                min="0"
                value={montoOverride ?? ""}
                placeholder={`${montoEfectivo} (calculado)`}
                onChange={e => setMontoOverride(e.target.value === "" ? null : Number(e.target.value))}
                className="w-36 border border-violet-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
              />
              {montoOverride !== null && (
                <>
                  <span className="text-xs text-stone-500">Con IVA: <strong className="text-violet-700">{fmtMXN(Math.round(Number(montoOverride) * (1 + Number(params.iva || 0.16))))}</strong></span>
                  <button onClick={() => setMontoOverride(null)} className="text-xs text-red-400 hover:text-red-600 underline">Quitar override</button>
                </>
              )}
              {montoOverride === null && <span className="text-xs text-stone-400 italic">Edita para fijar un monto diferente al calculado</span>}
            </div>
          </div>
        )}
      </div>

      {/* Calendario imprimible - visible en pantalla y al imprimir */}
      {pacienteId && (
        <div id="calendario-print" className="bg-white" style={{fontFamily:"'Helvetica Neue', Arial, sans-serif", maxWidth:"100%", padding:"18px 22px"}}>

          {/* ── HEADER: Logo izq + contacto der ── */}
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"14px", paddingBottom:"12px", borderBottom:"2px solid #ede9e6", background:"linear-gradient(135deg, #faf5ff 0%, #f5f3ff 100%)", borderRadius:"12px", padding:"12px 16px"}}>
            <div>
              <img
                src="https://media.base44.com/images/public/69ecf337cc17ef420867cd71/cffec5a1c_WhatsAppImage2026-04-25at122318.jpg"
                alt="con-sentido logo"
                style={{height:"58px", width:"auto"}}
              />
            </div>
            <div style={{textAlign:"right", fontSize:"9.5px", color:"#6d28d9", lineHeight:"1.8", fontWeight:"500"}}>
              <div>anapaula@centroconsentido.com &nbsp;&nbsp; IG: @centro.consentido</div>
              <div>Rio Colorado 213 Ote, piso 2</div>
              <div>Del Valle, SPGG, 66220.</div>
              <div>WA: 81 - 2581 - 8016</div>
            </div>
          </div>

          {/* ── TÍTULO ── */}
          <h2 style={{textAlign:"center", fontSize:"17px", fontWeight:"800", color:"#4c1d95", marginBottom:"6px", letterSpacing:"1.5px", textTransform:"uppercase", borderBottom:"none"}}>
            Horario Mensual de Terapias
          </h2>

          {/* ── MES Y AÑO destacado ── */}
          <div style={{textAlign:"center", marginBottom:"14px"}}>
            <span style={{display:"inline-block", background:"linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)", color:"white", borderRadius:"50px", padding:"8px 48px", fontSize:"26px", fontWeight:"900", letterSpacing:"3px", boxShadow:"0 4px 15px rgba(109,40,217,0.35)"}}>
              {mesLabel.toUpperCase()} {anio}
            </span>
          </div>

          {/* ── DATOS + NOTA (2 columnas) ── */}
          <div style={{display:"flex", gap:"14px", marginBottom:"12px", alignItems:"stretch"}}>
            <div style={{flex:"1", fontSize:"12px", lineHeight:"2", background:"#f9f5ff", borderRadius:"10px", padding:"10px 14px", border:"1px solid #e9d5ff"}}>
              <div><span style={{fontWeight:"800", color:"#6d28d9"}}>Nombre:</span> <span style={{fontWeight:"500", color:"#1c1917"}}>{paciente?.nombre}</span></div>
              <div><span style={{fontWeight:"800", color:"#6d28d9"}}>Tipo de Terapia:</span> <span style={{fontWeight:"500", color:"#1c1917"}}>{paciente?.tipo_terapia || "Terapia Ocupacional"}</span></div>
            </div>
            <div style={{flex:"1.2", border:"1.5px solid #fca5a5", borderRadius:"10px", padding:"10px 12px", fontSize:"8.5px", color:"#991b1b", fontWeight:"600", lineHeight:"1.5", background:"#fff5f5"}}>
              NOTA: Se permite realizar una cancelación al mes, siempre y cuando se notifique con anticipación antes de la fecha establecida para tales avisos, a fin de procesar el descuento correspondiente. Pasada esta fecha límite, no se autorizarán descuentos. En caso de imposibilidad de asistencia, nos complace buscar la reposición de la sesión, sujeto a la disponibilidad de nuestra agenda. En caso de no lograr reprogramar la sesión, no se aplicará el descuento correspondiente. Les recordamos que la constancia en las sesiones terapéuticas es clave para asegurar el progreso del paciente.
            </div>
          </div>

          {/* ── GRID CALENDARIO ── */}
          <table style={{width:"100%", borderCollapse:"separate", borderSpacing:"0", marginBottom:"10px", fontSize:"10px", borderRadius:"10px", overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.08)", border:"1px solid #e4e0fb"}}>
            <thead>
              <tr>
                {["Lunes","Martes","Miérc.","Jueves","Viernes","Sábado","Domingo"].map(d => (
                  <th key={d} style={{background:"linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)", color:"white", fontWeight:"700", padding:"9px 2px", textAlign:"center", fontSize:"11px", letterSpacing:"0.5px", textTransform:"uppercase"}}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {celdas.map((semana, fi) => (
                <tr key={fi}>
                  {semana.map((celda, ci) => (
                    <td key={ci} style={{border:"1px solid #ede9e6", height:"60px", verticalAlign:"top", padding:"4px 3px", background: celda.dia === null ? "#f5f3ff" : "white", width:"14.28%", transition:"background 0.2s"}}>
                      {celda.dia !== null && (() => {
                        const repoData = reposicionesMap[celda.dia];
                        const esReposicion = !!repoData;
                        return (
                          <>
                            <span style={{color:"#7c3aed", fontSize:"10px", fontWeight:"700"}}>{celda.dia}</span>
                            {/* Reposición: tiene prioridad visual sobre todo */}
                            {esReposicion && (
                              <div style={{display:"flex", flexDirection:"column", alignItems:"center", marginTop:"2px", gap:"2px"}}>
                                <div style={{background:"linear-gradient(135deg, #16a34a 0%, #15803d 100%)", color:"white", borderRadius:"6px", padding:"3px 4px", fontSize:"9px", fontWeight:"800", width:"100%", textAlign:"center", boxSizing:"border-box", boxShadow:"0 1px 3px rgba(22,163,74,0.4)"}}>
                                 {repoData.hora}
                                </div>
                                <span style={{fontSize:"7.5px", color:"white", fontWeight:"800", background:"#15803d", borderRadius:"4px", padding:"1px 5px", letterSpacing:"0.5px"}}>REP</span>
                                {repoData.tipoRep === "Matutina" && (
                                  <span style={{fontSize:"7.5px", color:"white", fontWeight:"800", background:"#b45309", borderRadius:"4px", padding:"1px 5px", letterSpacing:"0.5px"}}>MAT</span>
                                )}
                              </div>
                            )}
                            {/* Sesión normal (solo si no es reposición) */}
                            {!esReposicion && celda.tipo === "sesion" && (
                              <div style={{display:"flex", flexDirection:"column", alignItems:"center", marginTop:"2px", gap:"2px"}}>
                                <div style={{background:"linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)", color:"white", borderRadius:"6px", padding:"3px 4px", fontSize:"9px", fontWeight:"800", width:"100%", textAlign:"center", boxSizing:"border-box", boxShadow:"0 1px 3px rgba(124,58,237,0.4)"}}>
                                  {celda.hora}
                                </div>
                                {(() => {
                                  const diaKey = DIAS_KEY[celda.diaSemana];
                                  const tipo = tipoSesion?.[diaKey] || "Regular";
                                  const terapeuta = terapeutas?.[diaKey];
                                  return (
                                    <>
                                      {tipo === "Matutina" && (
                                        <span style={{fontSize:"7.5px", color:"white", fontWeight:"800", background:"#b45309", borderRadius:"4px", padding:"1px 5px", letterSpacing:"0.5px"}}>MAT</span>
                                      )}
                                      
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                            {/* Excepción (solo si no es reposición) */}
                            {!esReposicion && celda.tipo === "excepcion" && (
                              <div style={{display:"flex", justifyContent:"center", alignItems:"center", marginTop:"4px"}}>
                                <div style={{background:"linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)", borderRadius:"50%", width:"28px", height:"28px", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 1px 3px rgba(220,38,38,0.4)"}}>
                                  <span style={{color:"white", fontWeight:"900", fontSize:"15px", lineHeight:"1"}}>✕</span>
                                </div>
                              </div>
                            )}
                            {/* Reposición en día libre (no es sesión regular) */}
                            {esReposicion && celda.tipo !== "sesion" && celda.tipo !== "excepcion" && null}
                          </>
                        );
                      })()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── LEYENDA ── */}
          <div style={{display:"flex", gap:"16px", marginBottom:"10px", fontSize:"9.5px", alignItems:"center", background:"#f9f5ff", borderRadius:"8px", padding:"7px 12px"}}>
            <div style={{display:"flex", alignItems:"center", gap:"6px"}}>
              <div style={{width:"14px", height:"14px", borderRadius:"4px", background:"linear-gradient(135deg, #7c3aed, #6d28d9)", boxShadow:"0 1px 2px rgba(109,40,217,0.3)"}}></div>
              <span style={{color:"#374151", fontWeight:"700"}}>Sesión regular</span>
            </div>
            <div style={{display:"flex", alignItems:"center", gap:"6px"}}>
              <div style={{width:"14px", height:"14px", borderRadius:"4px", background:"linear-gradient(135deg, #16a34a, #15803d)", boxShadow:"0 1px 2px rgba(22,163,74,0.3)"}}></div>
              <span style={{color:"#374151", fontWeight:"700"}}>Reposición</span>
            </div>
            <div style={{display:"flex", alignItems:"center", gap:"6px"}}>
              <div style={{width:"14px", height:"14px", borderRadius:"50%", background:"linear-gradient(135deg, #dc2626, #b91c1c)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 1px 2px rgba(220,38,38,0.3)"}}>
                <span style={{color:"white", fontWeight:"900", fontSize:"9px", lineHeight:"1"}}>✕</span>
              </div>
              <span style={{color:"#374151", fontWeight:"700"}}>Día sin sesión</span>
            </div>
          </div>

          {/* ── RESUMEN DE MONTOS ── */}
          <div style={{fontSize:"10.5px", lineHeight:"1.8", background:"linear-gradient(135deg, #f9f5ff 0%, #faf5ff 100%)", borderRadius:"12px", padding:"12px 16px", border:"1px solid #e9d5ff", boxShadow:"0 2px 8px rgba(109,40,217,0.08)"}}>
            <div style={{fontWeight:"800", color:"#4c1d95", borderBottom:"1px solid #e9d5ff", paddingBottom:"6px", marginBottom:"6px"}}>
              Número de Sesiones: <span style={{fontWeight:"400"}}>{totalSesiones} sesiones{reposicionesValidas.length > 0 ? ` + ${reposicionesValidas.length} reposición(es)` : ""} = {totalSesiones + reposicionesValidas.length} en total</span>
            </div>
            <div style={{fontWeight:"600", color:"#1c1917"}}>
              <span style={{fontWeight:"800", color:"#6d28d9"}}>Monto Total del Mes:</span>{" "}
              Pago en Efectivo: {fmtMXN(montoEfectivo)} pesos &nbsp;|&nbsp; Pago en Tarjeta/transferencia/depósito + IVA: {fmtMXN(montoTransferencia)}
            </div>
            <div style={{fontSize:"9px", fontStyle:"italic", color:"#6b7280", marginTop:"6px", lineHeight:"1.6", borderTop:"1px solid #e9d5ff", paddingTop:"6px"}}>
              *El pago se debe cubrir, por{" "}
              <span style={{textDecoration:"underline"}}>tarjeta</span>,{" "}
              <span style={{textDecoration:"underline"}}>transferencia, depósito</span>{" "}
              o en <span style={{textDecoration:"underline"}}>efectivo</span> antes del día{" "}
              <strong>{params.dia_tope_pago || 10}</strong> del mes.
              De lo contrario se les pedirá a los padres un recargo del {((Number(params.recargo_pago_tarde || 0.10)) * 100).toFixed(0)}%.
              Cuando se hace depósito/transferencia, se solicita una foto del recibo para registro.
            </div>
            {pagado && (
              <div style={{marginTop:"6px", fontWeight:"800", color:"#4c1d95"}}>
                Pagado: <span style={{background:"#d1fae5", color:"#065f46", padding:"2px 10px", borderRadius:"6px", fontWeight:"700", border:"1px solid #a7f3d0"}}>{pagado}</span>
              </div>
            )}


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