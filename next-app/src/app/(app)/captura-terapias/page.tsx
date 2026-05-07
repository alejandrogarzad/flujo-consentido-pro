"use client";

import { useState, useEffect } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db, type AuthUser } from "@/lib/db";
import { MESES } from "@/lib/calculos";
import type { FormaPago, Paciente } from "@/types/db";

const FORMAS_PAGO: FormaPago[] = ["Efectivo", "Transferencia", "Tarjeta", "Depósito"];

interface FormState {
  paciente_id: string;
  paciente_nombre: string;
  anio: number;
  mes: number;
  sesiones_matutinas: number;
  sesiones_regulares: number;
  beca_porcentaje: number;
  forma_pago_mes: FormaPago;
  excepciones_dias: string;
  notas: string;
}

const empty: FormState = {
  paciente_id: "",
  paciente_nombre: "",
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  sesiones_matutinas: 0,
  sesiones_regulares: 0,
  beca_porcentaje: 0,
  forma_pago_mes: "Efectivo",
  excepciones_dias: "",
  notas: "",
};

export default function CapturaTerapiasPage() {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [form, setForm] = useState<FormState>(empty);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    db.paciente.filter({ estatus: "Activo" }, "nombre", 200).then(setPacientes);
    db.auth.me().then(setUser);
  }, []);

  const onPacienteChange = (id: string) => {
    const p = pacientes.find((p) => p.id === id);
    setForm((prev) => ({
      ...prev,
      paciente_id: id,
      paciente_nombre: p?.nombre ?? "",
      forma_pago_mes: p?.forma_pago_default ?? "Efectivo",
    }));
  };

  const submit = async () => {
    if (!form.paciente_id) {
      toast.error("Selecciona un paciente");
      return;
    }
    setLoading(true);
    try {
      const existing = await db.sesion_mensual.filter({
        paciente_id: form.paciente_id,
        anio: form.anio,
        mes: form.mes,
      });
      if (existing.length > 0) {
        if (!confirm(`Ya existe captura para ${form.paciente_nombre} en ${MESES[form.mes - 1]} ${form.anio}. ¿Sobrescribir?`)) {
          setLoading(false);
          return;
        }
        await db.sesion_mensual.update(existing[0].id, { ...form, capturado_por: user?.email ?? null });
      } else {
        await db.sesion_mensual.create({ ...form, capturado_por: user?.email ?? null });
      }
      setSuccess(true);
      toast.success("Capturado correctamente");
      setForm((prev) => ({ ...empty, anio: prev.anio, mes: prev.mes }));
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      toast.error(err?.message || "Error al capturar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-start justify-center pt-10 px-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-stone-800">Captura de Terapias</h1>
          <p className="text-sm text-stone-400 mt-1">Solo completa las celdas del mes. No se muestran montos ni saldos.</p>
        </div>

        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 flex items-center gap-2 text-sm">
            <CheckCircle size={16} /> Capturado correctamente
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Paciente *</label>
            <select
              value={form.paciente_id}
              onChange={(e) => onPacienteChange(e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
            >
              <option value="">— Seleccionar paciente —</option>
              {pacientes.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Mes</label>
              <select
                value={form.mes}
                onChange={(e) => setForm({ ...form, mes: Number(e.target.value) })}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Año</label>
              <input
                type="number"
                value={form.anio}
                onChange={(e) => setForm({ ...form, anio: Number(e.target.value) })}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Sesiones Matutinas</label>
              <input
                type="number"
                min="0"
                value={form.sesiones_matutinas}
                onChange={(e) => setForm({ ...form, sesiones_matutinas: Number(e.target.value) })}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Sesiones Regulares</label>
              <input
                type="number"
                min="0"
                value={form.sesiones_regulares}
                onChange={(e) => setForm({ ...form, sesiones_regulares: Number(e.target.value) })}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">% Beca del mes</label>
              <input
                type="number"
                min="0"
                max="100"
                value={form.beca_porcentaje}
                onChange={(e) => setForm({ ...form, beca_porcentaje: Number(e.target.value) })}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Forma de Pago del mes</label>
              <select
                value={form.forma_pago_mes}
                onChange={(e) => setForm({ ...form, forma_pago_mes: e.target.value as FormaPago })}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                {FORMAS_PAGO.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Días sin sesión (separados por coma, ej: 1, 3, 17)</label>
            <input
              value={form.excepciones_dias}
              onChange={(e) => setForm({ ...form, excepciones_dias: e.target.value })}
              placeholder="Ej: 1, 5, 20"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Notas (opcional)</label>
            <textarea
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              rows={2}
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
