"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Edit2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { MESES } from "@/lib/calculos";
import type { DiaSemana, Empleado, EstatusPaciente, HorarioSemanal, Paciente, TipoSesionSemanal } from "@/types/db";

const ESTATUSES: EstatusPaciente[] = ["Activo", "Inactivo", "Pausado"];
const DIAS: DiaSemana[] = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
const DIAS_LABEL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const TIPOS_SESION = ["Regular", "Matutina"] as const;
const ANIOS = Array.from({ length: 15 }, (_, i) => 2015 + i);

const emptyDias = (): HorarioSemanal => ({
  lunes: "", martes: "", miercoles: "", jueves: "", viernes: "", sabado: "", domingo: "",
});

interface FormState {
  nombre: string;
  precio_sesion_regular: number;
  precio_sesion_matutina: number;
  mes_inicio: number | null;
  anio_inicio: number | null;
  mes_alta: number | null;
  anio_alta: number | null;
  dias_sesion: HorarioSemanal;
  tipo_sesion: TipoSesionSemanal;
  terapeutas: HorarioSemanal;
  estatus: EstatusPaciente;
  notas: string;
}

const empty: FormState = {
  nombre: "",
  precio_sesion_regular: 0,
  precio_sesion_matutina: 0,
  mes_inicio: null,
  anio_inicio: null,
  mes_alta: null,
  anio_alta: null,
  dias_sesion: emptyDias(),
  tipo_sesion: emptyDias() as TipoSesionSemanal,
  terapeutas: emptyDias(),
  estatus: "Activo",
  notas: "",
};

export default function PacientesPage() {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ps, emps] = await Promise.all([
        db.paciente.list("-created_date", 200),
        db.empleado.filter({ estatus: "Activo" }, "nombre", 200),
      ]);
      setPacientes(ps);
      setEmpleados(emps.filter((e) => e.puesto === "Terapeuta" || e.puesto === "Coordinadora"));
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar pacientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = db.paciente.subscribe(() => load());
    return unsubscribe;
  }, [load]);

  const openNew = () => {
    setForm(empty);
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (p: Paciente) => {
    setForm({
      nombre: p.nombre,
      precio_sesion_regular: p.precio_sesion_regular ?? 0,
      precio_sesion_matutina: p.precio_sesion_matutina ?? 0,
      mes_inicio: p.mes_inicio,
      anio_inicio: p.anio_inicio,
      mes_alta: p.mes_alta,
      anio_alta: p.anio_alta,
      dias_sesion: { ...emptyDias(), ...(p.dias_sesion ?? {}) },
      tipo_sesion: { ...emptyDias(), ...(p.tipo_sesion ?? {}) } as TipoSesionSemanal,
      terapeutas: { ...emptyDias(), ...(p.terapeutas ?? {}) },
      estatus: p.estatus,
      notas: p.notas ?? "",
    });
    setEditing(p.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) {
      toast.error("Nombre es requerido");
      return;
    }
    setSaving(true);
    try {
      let pacienteId: string;
      if (editing) {
        await db.paciente.update(editing, form);
        pacienteId = editing;
      } else {
        const created = await db.paciente.create(form);
        pacienteId = created.id;
      }

      // Generar calendarios retroactivos desde mes_inicio hasta hoy
      if (form.mes_inicio && form.anio_inicio) {
        const hoy = new Date();
        const mesHoy = hoy.getMonth() + 1;
        const anioHoy = hoy.getFullYear();
        const calsExistentes = await db.calendario_paciente.filter({ paciente_id: pacienteId });
        const calsSet = new Set(calsExistentes.map((c) => `${c.anio}-${c.mes}`));

        const operaciones: Promise<unknown>[] = [];
        let a = form.anio_inicio;
        let m = form.mes_inicio;
        while (a < anioHoy || (a === anioHoy && m <= mesHoy)) {
          const key = `${a}-${m}`;
          if (!calsSet.has(key)) {
            operaciones.push(db.calendario_paciente.create({
              paciente_id: pacienteId,
              paciente_nombre: form.nombre,
              anio: a,
              mes: m,
              horario: form.dias_sesion,
              tipo_sesion: form.tipo_sesion,
              terapeutas: form.terapeutas,
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
            const cal = calsExistentes.find((c) => c.anio === a && c.mes === m);
            const horarioVacio = !cal?.horario || Object.values(cal.horario).every((v) => !v);
            if (cal && horarioVacio) {
              operaciones.push(db.calendario_paciente.update(cal.id, {
                horario: form.dias_sesion,
                tipo_sesion: form.tipo_sesion,
                terapeutas: form.terapeutas,
              }));
            }
          }
          m++;
          if (m > 12) {
            m = 1;
            a++;
          }
        }
        if (operaciones.length > 0) await Promise.all(operaciones);
      }

      toast.success(editing ? "Paciente actualizado" : "Paciente creado");
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar paciente?")) return;
    try {
      await db.paciente.delete(id);
      toast.success("Paciente eliminado");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al eliminar");
    }
  };

  const filtered = pacientes.filter((p) =>
    p.nombre?.toLowerCase().includes(search.toLowerCase()),
  );
  const uniqueFiltered = Array.from(
    new Map(filtered.map((p) => [p.nombre?.toLowerCase() ?? "", p])).values(),
  ).sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""));

  const setDia = (campo: "dias_sesion" | "tipo_sesion" | "terapeutas", dia: DiaSemana, val: string) => {
    setForm((f) => ({ ...f, [campo]: { ...f[campo], [dia]: val } }));
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
          onChange={(e) => setSearch(e.target.value)}
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
                <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : uniqueFiltered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-400">Sin pacientes</td></tr>
              ) : (
                uniqueFiltered.map((p, idx) => (
                  <tr key={p.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 text-stone-400">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-stone-800">{p.nombre}</td>
                    <td className="px-4 py-3 text-right text-stone-600">
                      {p.precio_sesion_regular ? `$${p.precio_sesion_regular}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center text-stone-600">
                      {p.mes_inicio ? `${MESES[p.mes_inicio - 1]} ${p.anio_inicio ?? ""}`.trim() : "—"}
                    </td>
                    <td className="px-4 py-3 text-center text-stone-600">
                      {p.mes_alta ? `${MESES[p.mes_alta - 1]} ${p.anio_alta ?? ""}`.trim() : "—"}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-800">{editing ? "Editar Paciente" : "Nuevo Paciente"}</h2>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-stone-400" /></button>
            </div>
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Nombre completo *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Inicio de Terapia</label>
                <div className="flex gap-2">
                  <select
                    value={form.mes_inicio ?? ""}
                    onChange={(e) => setForm({ ...form, mes_inicio: e.target.value ? Number(e.target.value) : null })}
                    className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                  >
                    <option value="">— Mes —</option>
                    {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select
                    value={form.anio_inicio ?? ""}
                    onChange={(e) => setForm({ ...form, anio_inicio: e.target.value ? Number(e.target.value) : null })}
                    className="w-24 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                  >
                    <option value="">— Año —</option>
                    {ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Alta / Fin de Terapia</label>
                <div className="flex gap-2">
                  <select
                    value={form.mes_alta ?? ""}
                    onChange={(e) => {
                      const mesAlta = e.target.value ? Number(e.target.value) : null;
                      setForm((f) => ({
                        ...f,
                        mes_alta: mesAlta,
                        estatus: mesAlta && f.anio_alta ? "Inactivo" : f.estatus,
                      }));
                    }}
                    className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                  >
                    <option value="">— Mes —</option>
                    {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select
                    value={form.anio_alta ?? ""}
                    onChange={(e) => {
                      const anioAlta = e.target.value ? Number(e.target.value) : null;
                      setForm((f) => ({
                        ...f,
                        anio_alta: anioAlta,
                        estatus: anioAlta && f.mes_alta ? "Inactivo" : f.estatus,
                      }));
                    }}
                    className="w-24 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                  >
                    <option value="">— Año —</option>
                    {ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Precio por Sesión ($)</label>
                <input
                  type="number"
                  min="0"
                  value={form.precio_sesion_regular || ""}
                  onChange={(e) => setForm({ ...form, precio_sesion_regular: Number(e.target.value) })}
                  placeholder="0 = usar precio global"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
                <p className="text-xs text-stone-400 mt-1">Dejar en 0 para usar el precio global de parámetros. Este precio aplica para todos los tipos de sesión.</p>
              </div>

              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Estatus</label>
                <select
                  value={form.estatus}
                  onChange={(e) => setForm({ ...form, estatus: e.target.value as EstatusPaciente })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                >
                  {ESTATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-2">
                  Horario Semanal — hora, tipo y terapeuta por día (dejar vacío si no hay sesión)
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {DIAS.map((d, i) => (
                    <div key={d} className="flex flex-col gap-1">
                      <p className="text-xs text-center text-stone-400">{DIAS_LABEL[i].substring(0, 3)}</p>
                      <input
                        value={form.dias_sesion[d] || ""}
                        onChange={(e) => setDia("dias_sesion", d, e.target.value)}
                        placeholder="3 pm"
                        className="w-full border border-stone-200 rounded-lg px-1 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                      <select
                        value={form.tipo_sesion[d] || "Regular"}
                        onChange={(e) => setDia("tipo_sesion", d, e.target.value)}
                        className="w-full border border-stone-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        {TIPOS_SESION.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <select
                        value={form.terapeutas[d] || ""}
                        onChange={(e) => setDia("terapeutas", d, e.target.value)}
                        className="w-full border border-stone-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        <option value="">—</option>
                        {empleados.map((e) => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-stone-400 mt-1">Selecciona el tipo (Regular/Matutina) y el terapeuta por día</p>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Notas</label>
                <textarea
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  rows={2}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50">Cancelar</button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear paciente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
