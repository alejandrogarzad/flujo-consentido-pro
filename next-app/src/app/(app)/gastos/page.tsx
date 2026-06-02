"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Edit2, Trash2, Filter } from "lucide-react";
import { toast } from "sonner";
import { db, type AuthUser } from "@/lib/db";
import { fmtMXN, MESES, parseFechaLocal } from "@/lib/calculos";
import type { CategoriaGasto, FormaPago, Gasto } from "@/types/db";

const CATEGORIAS_FILTER = ["Todas", "Renta", "Materiales Centro", "Materiales Limpieza", "Comidas", "Servicios", "Renta Terapeutas", "Capacitaciones", "Nómina", "Impuestos", "Otros"] as const;
const CATEGORIAS: CategoriaGasto[] = ["Renta", "Materiales Centro", "Materiales Limpieza", "Comidas", "Servicios", "Renta Terapeutas", "Capacitaciones", "Nómina", "Impuestos", "Otros"];
const FORMAS_PAGO: FormaPago[] = ["Efectivo", "Transferencia", "Tarjeta", "Depósito"];

interface FormState {
  fecha: string;
  categoria: CategoriaGasto;
  concepto: string;
  monto: number | string;
  con_factura: boolean;
  forma_pago: FormaPago;
  proveedor: string;
  notas: string;
}

const empty = (): FormState => ({
  fecha: new Date().toISOString().split("T")[0],
  categoria: "Otros",
  concepto: "",
  monto: "",
  con_factura: false,
  forma_pago: "Efectivo",
  proveedor: "",
  notas: "",
});

export default function GastosPage() {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty());
  const [filtroCat, setFiltroCat] = useState<(typeof CATEGORIAS_FILTER)[number]>("Todas");
  const [filtroMes, setFiltroMes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const load = useCallback(async () => {
    try {
      // listAll() pagina internamente; .list(1000) topa exactamente en el cap.
      const g = await db.gasto.listAll("-fecha");
      setGastos(g);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar gastos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    db.auth.me().then(setUser);
    const unsubscribe = db.gasto.subscribe(() => load());
    return unsubscribe;
  }, [load]);

  const openNew = () => {
    setForm(empty());
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (g: Gasto) => {
    setForm({
      fecha: g.fecha,
      categoria: g.categoria,
      concepto: g.concepto,
      monto: g.monto,
      con_factura: g.con_factura,
      forma_pago: g.forma_pago,
      proveedor: g.proveedor ?? "",
      notas: g.notas ?? "",
    });
    setEditing(g.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.concepto.trim() || !form.monto) {
      toast.error("Concepto y monto son requeridos");
      return;
    }
    setSaving(true);
    try {
      const data = { ...form, monto: Number(form.monto), capturado_por: user?.email ?? null };
      if (editing) {
        await db.gasto.update(editing, data);
        toast.success("Gasto actualizado");
      } else {
        await db.gasto.create(data);
        toast.success("Gasto creado");
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
    if (!confirm("¿Eliminar gasto?")) return;
    try {
      await db.gasto.delete(id);
      toast.success("Gasto eliminado");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al eliminar");
    }
  };

  const filtered = gastos.filter((g) => {
    const catOk = filtroCat === "Todas" || g.categoria === filtroCat;
    const mesOk = filtroMes === 0 || (parseFechaLocal(g.fecha) ?? new Date(0)).getMonth() + 1 === filtroMes;
    return catOk && mesOk;
  });
  const totalFiltrado = filtered.reduce((s, g) => s + Number(g.monto || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Diario de Gastos</h1>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl"
        >
          <Plus size={16} /> Nuevo Gasto
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Filter size={16} className="text-stone-400" />
        <select
          value={filtroCat}
          onChange={(e) => setFiltroCat(e.target.value as (typeof CATEGORIAS_FILTER)[number])}
          className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
        >
          {CATEGORIAS_FILTER.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select
          value={filtroMes}
          onChange={(e) => setFiltroMes(Number(e.target.value))}
          className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
        >
          <option value={0}>Todos los meses</option>
          {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <span className="ml-auto text-sm font-semibold text-stone-700">
          Total: <span className="text-red-600">{fmtMXN(totalFiltrado)}</span>
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Categoría</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Concepto</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Monto</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Factura</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Forma Pago</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Proveedor</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400">Sin gastos</td></tr>
              ) : (
                filtered.map((g) => (
                  <tr key={g.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 text-stone-600">{g.fecha}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">{g.categoria}</span>
                    </td>
                    <td className="px-4 py-3 text-stone-800">{g.concepto}</td>
                    <td className="px-4 py-3 text-right font-medium text-stone-800">{fmtMXN(g.monto)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${g.con_factura ? "bg-green-100 text-green-700" : "bg-stone-100 text-stone-500"}`}>
                        {g.con_factura ? "Sí" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{g.forma_pago}</td>
                    <td className="px-4 py-3 text-stone-600">{g.proveedor || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(g)} className="text-stone-400 hover:text-violet-600 mr-2"><Edit2 size={14} /></button>
                      <button onClick={() => del(g.id)} className="text-stone-400 hover:text-red-500"><Trash2 size={14} /></button>
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-800">{editing ? "Editar Gasto" : "Nuevo Gasto"}</h2>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-stone-400" /></button>
            </div>
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Fecha</label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Categoría</label>
                <select
                  value={form.categoria}
                  onChange={(e) => setForm({ ...form, categoria: e.target.value as CategoriaGasto })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                >
                  {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Concepto *</label>
                <input
                  value={form.concepto}
                  onChange={(e) => setForm({ ...form, concepto: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Monto *</label>
                <input
                  type="number"
                  min="0"
                  value={form.monto}
                  onChange={(e) => setForm({ ...form, monto: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Forma de Pago</label>
                <select
                  value={form.forma_pago}
                  onChange={(e) => setForm({ ...form, forma_pago: e.target.value as FormaPago })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                >
                  {FORMAS_PAGO.map((f) => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Proveedor</label>
                <input
                  value={form.proveedor}
                  onChange={(e) => setForm({ ...form, proveedor: e.target.value })}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="factura"
                  checked={form.con_factura}
                  onChange={(e) => setForm({ ...form, con_factura: e.target.checked })}
                  className="w-4 h-4 rounded accent-violet-600"
                />
                <label htmlFor="factura" className="text-sm text-stone-700">Con factura (IVA acreditable)</label>
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
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Guardando..." : editing ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
