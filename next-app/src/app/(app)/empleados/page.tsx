"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { fmtMXN, diasVacacionesLFT } from "@/lib/calculos";
import type { Empleado, EstatusEmpleado } from "@/types/db";

interface FormState {
  nombre: string;
  iniciales: string;
  puesto: string;
  sueldo_transferencia_mes: number;
  sueldo_efectivo_mes: number;
  fecha_ingreso: string;
  estatus: EstatusEmpleado;
  notas: string;
}

const empty: FormState = {
  nombre: "",
  iniciales: "",
  puesto: "",
  sueldo_transferencia_mes: 0,
  sueldo_efectivo_mes: 0,
  fecha_ingreso: "",
  estatus: "Activo",
  notas: "",
};

function calcAnios(fechaIngreso: string | null): number {
  if (!fechaIngreso) return 0;
  const d = new Date(fechaIngreso);
  const hoy = new Date();
  return Math.floor((hoy.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

export default function EmpleadosPage() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bonosPorEmpleado, setBonosPorEmpleado] = useState<Record<string, number>>({});
  const [bonoEdit, setBonoEdit] = useState<number | string>(0);

  const anioActual = new Date().getFullYear();

  const load = useCallback(async () => {
    try {
      const [emp, nomDic] = await Promise.all([
        db.empleado.listAll("nombre"),
        db.nomina_mensual.filter({ mes: 12, anio: anioActual }),
      ]);
      setEmpleados(emp);
      const bonos: Record<string, number> = {};
      nomDic.forEach((n) => {
        bonos[n.empleado_id] = Number(n.bono || 0);
      });
      setBonosPorEmpleado(bonos);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar empleados");
    } finally {
      setLoading(false);
    }
  }, [anioActual]);

  useEffect(() => {
    load();
    const unsubscribe = db.empleado.subscribe(() => load());
    return unsubscribe;
  }, [load]);

  const openNew = () => {
    setForm(empty);
    setBonoEdit(0);
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (e: Empleado) => {
    setForm({
      nombre: e.nombre,
      iniciales: e.iniciales ?? "",
      puesto: e.puesto ?? "",
      sueldo_transferencia_mes: e.sueldo_transferencia_mes,
      sueldo_efectivo_mes: e.sueldo_efectivo_mes,
      fecha_ingreso: e.fecha_ingreso ?? "",
      estatus: e.estatus,
      notas: e.notas ?? "",
    });
    setBonoEdit(bonosPorEmpleado[e.id] ?? 0);
    setEditing(e.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) {
      toast.error("Nombre es requerido");
      return;
    }
    setSaving(true);
    try {
      const data = {
        ...form,
        fecha_ingreso: form.fecha_ingreso || null,
        iniciales: form.iniciales || null,
        puesto: form.puesto || null,
        notas: form.notas || null,
      };
      if (editing) {
        await db.empleado.update(editing, data);

        const st = Number(form.sueldo_transferencia_mes || 0);
        const se = Number(form.sueldo_efectivo_mes || 0);

        // Sync sueldos al mes en curso + futuros pendientes del año actual
        const now = new Date();
        const valActual = now.getFullYear() * 100 + (now.getMonth() + 1);
        const todasNom = await db.nomina_mensual.filter({ empleado_id: editing, anio: anioActual });
        const aSyncear = todasNom.filter((n) => (n.anio * 100 + n.mes) >= valActual);
        for (const n of aSyncear) {
          await db.nomina_mensual.update(n.id, {
            sueldo_transferencia: st,
            sueldo_efectivo: se,
            empleado_nombre: form.nombre,
          });
        }

        // Bono de diciembre (lógica existente)
        const nomDic = aSyncear.find((n) => n.mes === 12)
          ?? (await db.nomina_mensual.filter({ mes: 12, anio: anioActual, empleado_id: editing }))[0];
        if (nomDic) {
          await db.nomina_mensual.update(nomDic.id, { bono: Number(bonoEdit) });
        } else {
          await db.nomina_mensual.create({
            empleado_id: editing,
            empleado_nombre: form.nombre,
            anio: anioActual,
            mes: 12,
            sueldo_transferencia: st,
            sueldo_efectivo: se,
            aguinaldo: 0,
            vacaciones: 0,
            bono: Number(bonoEdit),
          });
        }
        toast.success(`Empleado actualizado · sync ${aSyncear.length} nómina(s) ${aSyncear.length > 0 ? "del mes corriente y futuros" : ""}`);
      } else {
        await db.empleado.create(data);
        toast.success("Empleado creado");
      }
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar empleado?")) return;
    try {
      await db.empleado.delete(id);
      toast.success("Empleado eliminado");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al eliminar");
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Catálogo de Empleados</h1>
        <button onClick={openNew} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
          <Plus size={16} /> Nuevo Empleado
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Nombre</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Puesto</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Sueldo Transf. <span className="text-violet-600">*Neto</span></th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Sueldo Efvo.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total/mes</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Antigüedad</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Días Vac.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Bono Anual <span className="text-stone-300 font-normal">(Dic {anioActual})</span></th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Estatus</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : empleados.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-stone-400">Sin empleados</td></tr>
              ) : (
                empleados.map((e) => {
                  const anios = calcAnios(e.fecha_ingreso);
                  const diasVac = diasVacacionesLFT(anios);
                  const total = Number(e.sueldo_transferencia_mes || 0) + Number(e.sueldo_efectivo_mes || 0);
                  const bonoAnual = bonosPorEmpleado[e.id] ?? 0;
                  return (
                    <tr key={e.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                      <td className="px-4 py-3 font-medium text-stone-800">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
                            {e.iniciales || e.nombre?.[0]}
                          </span>
                          {e.nombre}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-stone-600">{e.puesto}</td>
                      <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(e.sueldo_transferencia_mes)}</td>
                      <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(e.sueldo_efectivo_mes)}</td>
                      <td className="px-4 py-3 text-right font-medium text-stone-800">{fmtMXN(total)}</td>
                      <td className="px-4 py-3 text-center text-stone-500">
                        {e.fecha_ingreso ? `${anios} año${anios !== 1 ? "s" : ""}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-stone-500">{diasVac}</td>
                      <td className="px-4 py-3 text-right font-medium">
                        {bonoAnual > 0
                          ? <span className="text-amber-600">{fmtMXN(bonoAnual)}</span>
                          : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${e.estatus === "Activo" ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"}`}>
                          {e.estatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => openEdit(e)} className="text-stone-400 hover:text-violet-600 mr-2"><Edit2 size={14} /></button>
                        <button onClick={() => del(e.id)} className="text-stone-400 hover:text-red-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-800">{editing ? "Editar Empleado" : "Nuevo Empleado"}</h2>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-stone-400" /></button>
            </div>
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Iniciales</label>
                <input
                  value={form.iniciales}
                  onChange={(e) => setForm({ ...form, iniciales: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Puesto</label>
                <input
                  value={form.puesto}
                  onChange={(e) => setForm({ ...form, puesto: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Sueldo Transferencia/mes <span className="text-violet-600">*Neto</span></label>
                <input
                  type="number"
                  min="0"
                  value={form.sueldo_transferencia_mes}
                  onChange={(e) => setForm({ ...form, sueldo_transferencia_mes: Number(e.target.value) })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
                <p className="text-xs text-stone-400 mt-1">Los impuestos se calculan automáticamente en nómina</p>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Sueldo Efectivo/mes</label>
                <input
                  type="number"
                  min="0"
                  value={form.sueldo_efectivo_mes}
                  onChange={(e) => setForm({ ...form, sueldo_efectivo_mes: Number(e.target.value) })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Fecha de Ingreso</label>
                <input
                  type="date"
                  value={form.fecha_ingreso}
                  onChange={(e) => setForm({ ...form, fecha_ingreso: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Estatus</label>
                <select
                  value={form.estatus}
                  onChange={(e) => setForm({ ...form, estatus: e.target.value as EstatusEmpleado })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                >
                  <option>Activo</option>
                  <option>Inactivo</option>
                </select>
              </div>
              {editing && (
                <div className="col-span-2">
                  <label className="text-xs font-medium text-stone-500 block mb-1">
                    Bono Anual <span className="text-amber-600">(Dic {anioActual})</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={bonoEdit}
                    onChange={(e) => setBonoEdit(e.target.value)}
                    className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                  />
                  <p className="text-xs text-stone-400 mt-1">Se guarda en la nómina de diciembre</p>
                </div>
              )}
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
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear empleado"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
