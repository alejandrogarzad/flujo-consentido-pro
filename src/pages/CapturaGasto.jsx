import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { CheckCircle } from "lucide-react";

const CATEGORIAS = ["Renta","Materiales Centro","Materiales Limpieza","Comidas","Servicios","Renta Terapeutas","Capacitaciones","Nómina","Impuestos","Otros"];
const FORMAS_PAGO = ["Efectivo","Transferencia","Tarjeta","Depósito"];

const empty = () => ({
  fecha: new Date().toISOString().split("T")[0],
  categoria: "Otros", concepto: "", monto: "",
  con_factura: false, forma_pago: "Efectivo",
  proveedor: "", notas: ""
});

export default function CapturaGasto() {
  const [form, setForm] = useState(empty());
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const submit = async () => {
    if (!form.concepto || !form.monto) return alert("Completa los campos obligatorios");
    setLoading(true);
    await base44.entities.Gasto.create({
      ...form,
      monto: Number(form.monto),
      capturado_por: user?.email
    });
    setSuccess(true);
    setForm(empty());
    setLoading(false);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-start justify-center pt-10 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-stone-800">Registrar Gasto</h1>
          <p className="text-sm text-stone-400 mt-1">Captura el gasto. No se muestran registros anteriores.</p>
        </div>

        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 flex items-center gap-2 text-sm">
            <CheckCircle size={16} /> Gasto registrado correctamente
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Fecha</label>
            <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Categoría *</label>
            <select value={form.categoria} onChange={e => setForm({...form, categoria: e.target.value})}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Concepto *</label>
            <input value={form.concepto} onChange={e => setForm({...form, concepto: e.target.value})}
              placeholder="Descripción del gasto"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Monto (MXN) *</label>
            <input type="number" min="0" value={form.monto} onChange={e => setForm({...form, monto: e.target.value})}
              placeholder="0.00"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Forma de Pago</label>
              <select value={form.forma_pago} onChange={e => setForm({...form, forma_pago: e.target.value})}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {FORMAS_PAGO.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex flex-col justify-center">
              <label className="text-xs font-medium text-stone-500 block mb-2">¿Con factura?</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.con_factura} onChange={e => setForm({...form, con_factura: e.target.checked})}
                  className="w-4 h-4 rounded accent-violet-600" />
                <span className="text-sm text-stone-700">Sí, con factura</span>
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Proveedor</label>
            <input value={form.proveedor} onChange={e => setForm({...form, proveedor: e.target.value})}
              placeholder="Nombre del proveedor"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Notas (opcional)</label>
            <textarea value={form.notas} onChange={e => setForm({...form, notas: e.target.value})}
              rows={2} className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>

          <button onClick={submit} disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-60">
            {loading ? "Registrando..." : "Registrar Gasto"}
          </button>
        </div>
      </div>
    </div>
  );
}