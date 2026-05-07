import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes"];
const DIAS_LABEL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

// Slots de 30 min de 9:00 a 19:00
const SLOTS = [];
for (let h = 9; h < 19; h++) {
  SLOTS.push(`${String(h).padStart(2,"0")}00`);
  SLOTS.push(`${String(h).padStart(2,"0")}30`);
}
const slotLabel = (s) => `${s.substring(0,2)}:${s.substring(2)}`;

const ACTIVIDADES = [
  "Sesion Terapia",
  "Libre",
  "Comida",
  "Evaluacion",
  "Retroalimentacion",
  "Junta Equipo",
];

// Actividades que NO llevan paciente
const SIN_PACIENTE = new Set(["Libre", "Comida", "Evaluacion", "Retroalimentacion", "Junta Equipo"]);

// Slot value stored as "Actividad|Paciente" or just "Actividad"
function encodeSlot(actividad, paciente) {
  if (actividad === "Sesion Terapia" && paciente) return `Sesion Terapia|${paciente}`;
  return actividad || "";
}
function decodeSlot(val) {
  if (!val) return { actividad: "", paciente: "" };
  if (val.startsWith("Sesion Terapia|")) {
    return { actividad: "Sesion Terapia", paciente: val.replace("Sesion Terapia|", "") };
  }
  return { actividad: val, paciente: "" };
}

function getCellBg(actividad) {
  if (!actividad) return "bg-white";
  if (actividad === "Libre") return "bg-green-500";
  if (actividad === "Comida") return "bg-amber-400";
  if (actividad === "Sesion Terapia") return "bg-violet-600";
  if (actividad === "Evaluacion") return "bg-orange-500";
  if (actividad === "Retroalimentacion") return "bg-sky-500";
  if (actividad === "Junta Equipo") return "bg-rose-500";
  return "bg-stone-400";
}

// Lunes de la semana actual
function getLunesActual() {
  const hoy = new Date();
  const day = hoy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff);
  return lunes.toISOString().split("T")[0];
}

export default function HorariosTerapeutas() {
  const [semana, setSemana] = useState(getLunesActual());
  const [terapeutas, setTerapeutas] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [horarios, setHorarios] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [emps, hors, pacs] = await Promise.all([
      base44.entities.Empleado.filter({ estatus: "Activo" }, "nombre", 50),
      base44.entities.HorarioTerapeuta.filter({ semana_inicio: semana }, "-created_date", 200),
      base44.entities.Paciente.filter({ estatus: "Activo" }, "nombre", 200),
    ]);
    setTerapeutas(emps.filter(e => e.puesto?.toLowerCase().includes("terapeuta") || e.puesto?.toLowerCase().includes("coordinadora")));
    setPacientes(pacs);
    const map = {};
    hors.forEach(h => { map[h.empleado_id] = { id: h.id, slots: h.slots || {} }; });
    setHorarios(map);
    setLoading(false);
  }, [semana]);

  useEffect(() => { load(); }, [load]);

  const getSlotRaw = (empId, dia, slot) => horarios[empId]?.slots?.[`${dia}_${slot}`] || "";

  const saveSlotRaw = async (empId, empNombre, dia, slot, rawValue) => {
    const key = `${dia}_${slot}`;
    const existing = horarios[empId];
    const newSlots = { ...(existing?.slots || {}), [key]: rawValue };
    if (existing?.id) {
      await base44.entities.HorarioTerapeuta.update(existing.id, { slots: newSlots });
      setHorarios(prev => ({ ...prev, [empId]: { ...existing, slots: newSlots } }));
    } else {
      const created = await base44.entities.HorarioTerapeuta.create({
        empleado_id: empId, empleado_nombre: empNombre, semana_inicio: semana, slots: newSlots,
      });
      setHorarios(prev => ({ ...prev, [empId]: { id: created.id, slots: newSlots } }));
    }
  };

  // Disponibilidad: cuántas tienen "Libre"
  const dispGrid = {};
  SLOTS.forEach(slot => {
    DIAS.forEach(dia => {
      const key = `${dia}_${slot}`;
      let libres = 0;
      terapeutas.forEach(t => {
        const raw = horarios[t.id]?.slots?.[key] || "";
        if (raw === "Libre") libres++;
      });
      dispGrid[key] = libres;
    });
  });

  // Convierte hora texto ("3pm", "10am", "15:00", etc.) a slot key "HHMM"
  const parseHoraToSlot = (horaStr) => {
    if (!horaStr) return null;
    const s = horaStr.trim().toLowerCase();
    // Formato "HH:MM"
    const hhmm = s.match(/^(\d{1,2}):(\d{2})/);
    if (hhmm) {
      return `${String(Number(hhmm[1])).padStart(2,"0")}${hhmm[2]}`;
    }
    // Formato "Xpm" o "Xam"
    const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (ampm) {
      let h = Number(ampm[1]);
      const min = ampm[2] ? ampm[2] : "00";
      if (ampm[3] === "pm" && h !== 12) h += 12;
      if (ampm[3] === "am" && h === 12) h = 0;
      return `${String(h).padStart(2,"0")}${min}`;
    }
    return null;
  };

  const cargarDesdePacientes = async () => {
    if (!confirm("¿Cargar horarios desde los pacientes? Se sobreescribirán los slots que ya tengan sesión asignada para esta semana.")) return;

    // Construir mapa: terapeuta_nombre -> { dia -> [{ slot, paciente }] }
    const mapaT = {};
    pacientes.forEach(pac => {
      if (!pac.dias_sesion || !pac.terapeutas) return;
      DIAS.forEach(dia => {
        const hora = pac.dias_sesion[dia];
        const terapeuta = pac.terapeutas[dia];
        if (!hora || !terapeuta) return;
        const slotKey = parseHoraToSlot(hora);
        if (!slotKey || !SLOTS.includes(slotKey)) return;
        if (!mapaT[terapeuta]) mapaT[terapeuta] = {};
        if (!mapaT[terapeuta][dia]) mapaT[terapeuta][dia] = [];
        mapaT[terapeuta][dia].push({ slot: slotKey, paciente: pac.nombre });
      });
    });

    // Para cada terapeuta, actualizar/crear su registro con los slots
    const ops = terapeutas.map(async (t) => {
      const sesiones = mapaT[t.nombre];
      if (!sesiones) return;
      const existing = horarios[t.id];
      const newSlots = { ...(existing?.slots || {}) };
      Object.entries(sesiones).forEach(([dia, lista]) => {
        lista.forEach(({ slot, paciente }) => {
          const key = `${dia}_${slot}`;
          newSlots[key] = encodeSlot("Sesion Terapia", paciente);
        });
      });
      if (existing?.id) {
        await base44.entities.HorarioTerapeuta.update(existing.id, { slots: newSlots });
      } else {
        await base44.entities.HorarioTerapeuta.create({
          empleado_id: t.id, empleado_nombre: t.nombre, semana_inicio: semana, slots: newSlots,
        });
      }
    });
    await Promise.all(ops);
    load();
  };

  const dispColor = (n) => {
    if (n === 0) return "bg-red-100 text-red-600";
    if (n <= 2) return "bg-yellow-100 text-yellow-700";
    return "bg-green-100 text-green-700";
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Horarios Terapeutas</h1>
          <p className="text-sm text-stone-400 mt-0.5">Selecciona actividad por slot. Si es "Sesion Terapia", elige el paciente.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-stone-500">Semana del lunes:</label>
          <input type="date" value={semana} onChange={e => setSemana(e.target.value)}
            className="border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          <button onClick={cargarDesdePacientes}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            Cargar desde Pacientes
          </button>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-3 mb-5 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-600 inline-block" /> Sesión Terapia</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Libre</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Comida</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500 inline-block" /> Evaluacion</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-sky-500 inline-block" /> Retroalimentacion</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500 inline-block" /> Junta Equipo</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> Paciente faltante</span>
      </div>

      {/* ── DISPONIBILIDAD GENERAL ── */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden mb-8">
        <div className="px-5 py-3 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-stone-700">Disponibilidad General — Terapeutas Libres por Slot</h2>
          <span className="text-xs text-stone-400">{terapeutas.length} terapeutas activas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-stone-400 font-medium border-b border-stone-100 w-16">Hora</th>
                {DIAS_LABEL.map(d => (
                  <th key={d} className="px-4 py-2 text-center font-semibold text-stone-600 border-b border-stone-100 min-w-[100px]">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map(slot => (
                <tr key={slot} className="border-t border-stone-50">
                  <td className="px-3 py-1.5 text-stone-400 font-mono">{slotLabel(slot)}</td>
                  {DIAS.map(dia => {
                    const n = dispGrid[`${dia}_${slot}`];
                    return (
                      <td key={dia} className="px-2 py-1.5 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${dispColor(n)}`}>{n}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── UN BLOQUE POR TERAPEUTA ── */}
      {terapeutas.length === 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-8 text-center text-stone-400 text-sm">
          No hay empleados activos con puesto "Terapeuta".
        </div>
      )}

      <div className="grid gap-6">
        {terapeutas.map(t => (
          <div key={t.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-violet-50 border-b border-violet-100">
              <h3 className="text-sm font-bold text-violet-800">{t.nombre}</h3>
              {t.puesto && <p className="text-xs text-violet-400">{t.puesto}</p>}
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-stone-400 font-medium border-b border-stone-100 w-16">Hora</th>
                    {DIAS_LABEL.map(d => (
                      <th key={d} className="px-2 py-2 text-center font-semibold text-stone-600 border-b border-stone-100 min-w-[200px]">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.map(slot => (
                    <tr key={slot} className="border-t border-stone-50">
                      <td className="px-3 py-1 text-stone-400 font-mono text-xs">{slotLabel(slot)}</td>
                      {DIAS.map(dia => {
                        const raw = getSlotRaw(t.id, dia, slot);
                        const { actividad, paciente } = decodeSlot(raw);
                        const bg = getCellBg(actividad);
                        const sinPaciente = SIN_PACIENTE.has(actividad);
                        const pacienteFaltante = actividad === "Sesion Terapia" && !paciente;

                        return (
                          <td key={dia} className={`px-1 py-1 border border-stone-50 ${bg}`}>
                            <div className="flex flex-col gap-0.5">
                              {/* Dropdown de actividad */}
                              <select
                                value={actividad}
                                onChange={e => {
                                  const newAct = e.target.value;
                                  const newRaw = encodeSlot(newAct, newAct === "Sesion Terapia" ? paciente : "");
                                  saveSlotRaw(t.id, t.nombre, dia, slot, newRaw);
                                }}
                                className={`w-full rounded px-1 py-0.5 text-xs font-bold border-0 focus:outline-none cursor-pointer
                                  ${!actividad ? "bg-white text-stone-300" : "text-white"}
                                `}
                                style={actividad ? { backgroundColor: "transparent" } : {}}
                              >
                                <option value="">— vacío —</option>
                                {ACTIVIDADES.map(a => <option key={a} value={a}>{a}</option>)}
                              </select>

                              {/* Dropdown de paciente — solo si es Sesion Terapia */}
                              {actividad === "Sesion Terapia" ? (
                                <select
                                  value={paciente}
                                  onChange={e => {
                                    const newRaw = encodeSlot("Sesion Terapia", e.target.value);
                                    saveSlotRaw(t.id, t.nombre, dia, slot, newRaw);
                                  }}
                                  className={`w-full rounded px-1 py-0.5 text-xs font-semibold border-0 focus:outline-none cursor-pointer
                                    ${pacienteFaltante ? "bg-red-100 text-red-600" : "bg-violet-700 text-white"}
                                  `}
                                >
                                  <option value="">— paciente —</option>
                                  {pacientes.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                                </select>
                              ) : (
                                actividad && (
                                  <div className="w-full rounded px-1 py-0.5 text-xs text-white/50 line-through select-none text-center">
                                    n/a
                                  </div>
                                )
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}