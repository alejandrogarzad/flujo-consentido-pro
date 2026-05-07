import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { fmtMXN, MESES, paramsToObject } from "@/lib/calculos";
import { Plus, X, Edit2, Trash2 } from "lucide-react";

const FORMAS_PAGO = ["Efectivo","Transferencia","Tarjeta","Depósito"];
const empty = { inquilino: "", forma_pago: "Efectivo", renta_mensual_base: 0, anio: new Date().getFullYear(), mes: new Date().getMonth() + 1, monto_cobrado: 0, notas: "" };

export default function Subarrendamiento() {
  const [registros, setRegistros] = useState([]);
  const [params, setParams] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([base44.entities.Subarrendamiento.list(), base44.entities.Parametro.list()])
      .then(([r, p]) => { setRegistros(r); setParams(paramsToObject(p)); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setShowForm(true); };
  const openEdit = (r) => { setForm(r); setEditing(r.id); setShowForm(true); };

  const save = async () => {
    const data = { ...form, monto_cobrado: Number(form.monto_cobrado), renta_mensual_base: Number(form.renta_mensual_base) };
    if (editing) await base44.entities.Subarrendamiento.update(editing, data);
    else await base44.entities.Subarrendamiento.create(data);
    setShowForm(false); load();
  };

  const del = async (id) => { if (!confirm("¿Eliminar?")) return; await base44.entities.Subarrendamiento.delete(id); load(); };

  const ivaRate = Number(params.iva || 0.16);

  // Agrupar por inquilino y año
  const inquilinos = [...new Set(registros.filter(r => r.anio === filtroAnio).map(r => r.inquilino))];

  const totalAnio = registros.filter(r => r.anio === filtroAnio).reduce((sum, r) => sum + Number(r.monto_cobrado || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Subarrendamiento</h1>
        <div className="flex items-center gap-2">
          <input type="number" value={filtroAnio} onChange={e => setFiltroAnio(Number(e.target.value))}
            className="w-20 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          <button onClick={openNew} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl">
            <Plus size={16} /> Nuevo Registro
          </button>
        </div>
      </div>

      {/* Resumen por inquilino */}
      {inquilinos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {inquilinos.map(inq => {
            const regsInq = registros.filter(r => r.inquilino === inq && r.anio === filtroAnio);
            const totalInq = regsInq.reduce((sum, r) => sum + Number(r.monto_cobrado || 0), 0);
            return (
              <div key={inq} className="bg-white rounded-xl border border-stone-100 p-4 shadow-sm">
                <p className="text-xs text-stone-400 mb-1">{inq}</p>
                <p className="text-lg font-bold text-violet-700">{fmtMXN(totalInq)}</p>
                <p className="text-xs text-stone-400">{regsInq.length} meses cobrados</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-600">Detalle por mes</h2>
          <span className="text-sm font-bold text-stone-700">Total año: <span className="text-violet-600">{fmtMXN(totalAnio)}</span></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Inquilino</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Mes</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Forma Pago</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Monto Cobrado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IVA</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : registros.filter(r => r.anio === filtroAnio).sort((a,b) => a.mes - b.mes).map(r => {
                const iva = r.forma_pago !== "Efectivo" ? Number(r.monto_cobrado || 0) * ivaRate : 0;
                return (
                  <tr key={r.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 font-medium text-stone-800">{r.inquilino}</td>
                    <td className="px-4 py-3 text-stone-600">{MESES[(r.mes || 1) - 1]}</td>
                    <td className="px-4 py-3 text-stone-600">{r.forma_pago}</td>
                    <td className="px-4 py-3 text-right font-medium text-stone-700">{fmtMXN(r.monto_cobrado)}</td>
                    <td className="px-4 py-3 text-right text-stone-500">{iva > 0 ? fmtMXN(iva) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(r)} className="text-stone-400 hover:text-violet-600 mr-2"><Edit2 size={14} /></button>
                      <button onClick={() => del(r.id)} className="text-stone-400 hover:text-red-500"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
              <h2 className="font-semibold text-stone-800">{editing ? "Editar Registro" : "Nuevo Registro"}</h2>
              <button onClick={() => setShowForm(false)}><X size={18} className="text-stone-400" /></button>
            </div>
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Inquilino *</label>
                <input value={form.inquilino} onChange={e => setForm({...form, inquilino: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Mes</label>
                <select value={form.mes} onChange={e => setForm({...form, mes: Number(e.target.value)})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Año</label>
                <input type="number" value={form.anio} onChange={e => setForm({...form, anio: Number(e.target.value)})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Forma de Pago</label>
                <select value={form.forma_pago} onChange={e => setForm({...form, forma_pago: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {FORMAS_PAGO.map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-stone-500 block mb-1">Monto Cobrado</label>
                <input type="number" min="0" value={form.monto_cobrado}
                  onChange={e => setForm({...form, monto_cobrado: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-stone-500 block mb-1">Notas</label>
                <textarea value={form.notas || ""} onChange={e => setForm({...form, notas: e.target.value})}
                  rows={2} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50">Cancelar</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700">{editing ? "Guardar" : "Crear"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}