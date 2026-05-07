import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Search, Edit2, Trash2, X } from "lucide-react";
import { MESES } from "@/lib/calculos";

const ESTATUSES = ["Activo","Inactivo","Pausado"];
const DIAS = ["lunes","martes","miercoles","jueves","viernes","sabado","domingo"];
const DIAS_LABEL = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const TIPOS_SESION = ["Regular","Matutina"];

const emptyDias = { lunes:"", martes:"", miercoles:"", jueves:"", viernes:"", sabado:"", domingo:"" };

const ANIOS = Array.from({ length: 15 }, (_, i) => 2015 + i); // 2015–2029

const empty = {
  nombre: "", 
  precio_sesion_regular: 0, precio_sesion_matutina: 0,
  mes_inicio: null, anio_inicio: null,
  mes_alta: null, anio_alta: null,
  dias_sesion: { ...emptyDias },
  tipo_sesion: { ...emptyDias },
  terapeutas: { ...emptyDias },
  estatus: "Activo", notas: ""
};

export default function Pacientes() {
  const [pacientes, setPacientes] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([
      base44.entities.Paciente.list("-created_date", 200),
      base44.entities.Empleado.filter({ estatus: "Activo" }, "nombre", 200)
    ]).then(([pacientes, empleadosData]) => {
      setPacientes(pacientes);
      setEmpleados(empleadosData.filter(e => e.puesto === "Terapeuta" || e.puesto === "Coordinadora"));
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); };
  const openEdit = (p) => {
    setForm({
      ...p,
      mes_inicio: p.mes_inicio || null,
      anio_inicio: p.anio_inicio || null,
      mes_alta: p.mes_alta || null,
      anio_alta: p.anio_alta || null,
      dias_sesion: p.dias_sesion || { ...emptyDias },
      tipo_sesion: p.tipo_sesion || { ...emptyDias },
      terapeutas: p.terapeutas || { ...emptyDias },
    });
    setEditing(p.id);
    setShowForm(true);
  };

  const save = async () => {
    let pacienteGuardado;
    if (editing) {
      await base44.entities.Paciente.update(editing, form);
      pacienteGuardado = { ...form, id: editing };
    } else {
      pacienteGuardado = await base44.entities.Paciente.create(form);
    }

    // Generar calendarios retroactivos desde mes_inicio hasta hoy
    const mesIni = form.mes_inicio;
    const anioIni = form.anio_inicio;
    if (mesIni && anioIni && pacienteGuardado?.id) {
      const hoy = new Date();
      const mesHoy = hoy.getMonth() + 1;
      const anioHoy = hoy.getFullYear();

      // Obtener calendarios ya existentes para este paciente
      const calsExistentes = await base44.entities.CalendarioPaciente.filter({ paciente_id: pacienteGuardado.id });
      const calsSet = new Set(calsExistentes.map(c => `${c.anio}-${c.mes}`));

      const operaciones = [];
      let a = anioIni, m = mesIni;
      while (a < anioHoy || (a === anioHoy && m <= mesHoy)) {
        const key = `${a}-${m}`;
        if (!calsSet.has(key)) {
          // Crear calendario nuevo
          operaciones.push(base44.entities.CalendarioPaciente.create({
            paciente_id: pacienteGuardado.id,
            paciente_nombre: form.nombre,
            anio: a,
            mes: m,
            horario: form.dias_sesion || {},
            tipo_sesion: form.tipo_sesion || {},
            terapeutas: form.terapeutas || {},
            excepciones: "",
            reposiciones: [],
            total_sesiones: 0,
            sesiones_regulares: 0,
            sesiones_matutinas: 0,
            reposiciones_count: 0,
            monto_efectivo: 0,
            monto_transferencia: 0,
          }));
        } else {
          // Actualizar horario en calendarios existentes que tengan horario vacío
          const calExistente = calsExistentes.find(c => c.anio === a && c.mes === m);
          const horarioVacio = !calExistente?.horario || Object.values(calExistente.horario).every(v => !v);
          if (horarioVacio) {
            operaciones.push(base44.entities.CalendarioPaciente.update(calExistente.id, {
              horario: form.dias_sesion || {},
              tipo_sesion: form.tipo_sesion || {},
              terapeutas: form.terapeutas || {},
            }));
          }
        }
        m++;
        if (m > 12) { m = 1; a++; }
      }
      if (operaciones.length > 0) await Promise.all(operaciones);
    }

    setShowForm(false);
    load();
  };

  const del = async (id) => {
    if (!confirm("¿Eliminar paciente?")) return;
    await base44.entities.Paciente.delete(id);
    load();
  };

  const filtered = pacientes.filter(p =>
    p.nombre?.toLowerCase().includes(search.toLowerCase())
  );
  
  // Deduplicar por nombre y ordenar alfabéticamente
  const uniqueFiltered = Array.from(
    new Map(filtered.map(p => [p.nombre?.toLowerCase() || '', p])).values()
  ).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  const setDia = (campo, dia, val) => {
    setForm(f => ({ ...f, [campo]: { ...f[campo], [dia]: val } }));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Catálogo de Pacientes</h1>
        <button onClick={openNew} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Plus size={16} /> Nuevo Paciente
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          placeholder="Buscar paciente..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
        />
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Nombre</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Precio por Sesión</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Inicio Terapia</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Alta</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Estatus</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : uniqueFiltered.map((p) => (
                <tr key={p.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3 text-stone-400">{uniqueFiltered.indexOf(p) + 1}</td>
                  <td className="px-4 py-3 font-medium text-stone-800">{p.nombre}</td>

                  <td className="px-4 py-3 text-right text-stone-600">
                    {p.precio_sesion_regular ? `$${p.precio_sesion_regular}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-stone-600">
                    {p.mes_inicio ? `${MESES[p.mes_inicio - 1]} ${p.anio_inicio || ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-stone-600">
                    {p.mes_alta ? `${MESES[p.mes_alta - 1]} ${p.anio_alta || ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium
                      ${p.estatus === "Activo" ? "bg-green-100 text-green-700" :
                        p.estatus === "Pausado" ? "bg-yellow-100 text-yellow-700" : "bg-stone-100 text-stone-500"}`}>
                      {p.estatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(p)} className="text-stone-400 hover:text-violet-600 mr-2 transition-colors"><Edit2 size={14} /></button>
                    <button onClick={() => del(p.id)} className="text-stone-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-800">{editing ? "Editar Paciente" : "Nuevo Paciente"}</h2>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-stone-400" /></button>
            </div>
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              {/* Nombre */}
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>

              {/* Inicio terapia: mes + año */}
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Inicio de Terapia</label>
                <div className="flex gap-2">
                  <select value={form.mes_inicio || ""} onChange={e => setForm({...form, mes_inicio: e.target.value ? Number(e.target.value) : null})}
                    className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                    <option value="">— Mes —</option>
                    {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                  <select value={form.anio_inicio || ""} onChange={e => setForm({...form, anio_inicio: e.target.value ? Number(e.target.value) : null})}
                    className="w-24 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                    <option value="">— Año —</option>
                    {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Alta: mes + año */}
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Alta / Fin de Terapia</label>
                <div className="flex gap-2">
                  <select value={form.mes_alta || ""} onChange={e => {
                    const mesAlta = e.target.value ? Number(e.target.value) : null;
                    setForm(f => ({ ...f, mes_alta: mesAlta, estatus: (mesAlta && f.anio_alta) ? "Inactivo" : f.estatus }));
                  }}
                    className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                    <option value="">— Mes —</option>
                    {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                  <select value={form.anio_alta || ""} onChange={e => {
                  const anioAlta = e.target.value ? Number(e.target.value) : null;
                  setForm(f => ({ ...f, anio_alta: anioAlta, estatus: (anioAlta && f.mes_alta) ? "Inactivo" : f.estatus }));
                }}
                    className="w-24 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                    <option value="">— Año —</option>
                    {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              {/* Precios por sesión */}
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Precio por Sesión ($)</label>
                <input type="number" min="0" value={form.precio_sesion_regular || ""}
                  onChange={e => setForm({...form, precio_sesion_regular: Number(e.target.value)})}
                  placeholder="0 = usar precio global"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                <p className="text-xs text-stone-400 mt-1">Dejar en 0 para usar el precio global de parámetros. Este precio aplica para todos los tipos de sesión.</p>
              </div>

              {/* Estatus */}
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Estatus</label>
                <select value={form.estatus} onChange={e => setForm({...form, estatus: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                  {ESTATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Horario semanal con tipo de sesión */}
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-2">
                  Horario Semanal — hora, tipo y terapeuta por día (dejar vacío si no hay sesión)
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {DIAS.map((d, i) => (
                    <div key={d} className="flex flex-col gap-1">
                      <p className="text-xs text-center text-stone-400">{DIAS_LABEL[i].substring(0,3)}</p>
                      <input
                        value={form.dias_sesion?.[d] || ""}
                        onChange={e => setDia("dias_sesion", d, e.target.value)}
                        placeholder="3 pm"
                        className="w-full border border-stone-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                      <select
                        value={form.tipo_sesion?.[d] || "Regular"}
                        onChange={e => setDia("tipo_sesion", d, e.target.value)}
                        className="w-full border border-stone-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        {TIPOS_SESION.map(t => <option key={t}>{t}</option>)}
                      </select>
                      <select
                        value={form.terapeutas?.[d] || ""}
                        onChange={e => setDia("terapeutas", d, e.target.value)}
                        className="w-full border border-stone-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        <option value="">—</option>
                        {empleados.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-stone-400 mt-1">Selecciona el tipo (Regular/Matutina) y el terapeuta por día</p>
              </div>

              {/* Notas */}
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Notas</label>
                <textarea value={form.notas || ""} onChange={e => setForm({...form, notas: e.target.value})}
                  rows={2} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50">Cancelar</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors">
                {editing ? "Guardar cambios" : "Crear paciente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}