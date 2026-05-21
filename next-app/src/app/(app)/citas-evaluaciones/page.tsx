"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Edit2, Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { db, type AuthUser } from "@/lib/db";
import {
  isLimitedToCurrentMonth, canCreateEvento, canEditEvento, canDeleteEvento,
} from "@/lib/permissions";
import { calcularTotalEvento, paramsToObject, fmtMXN, MESES, type ParamMap } from "@/lib/calculos";
import type { Evento, FormaPago, Paciente, TipoEvento } from "@/types/db";

const TIPOS_CITAS: TipoEvento[] = ["Cita inicial / ingreso", "Cita seguimiento directora", "Cita escolar virtual", "Cita escolar presencial", "Observación escolar", "Reporte adicional"];
const TIPOS_EVALUACIONES: TipoEvento[] = ["Evaluación"];
const FORMAS_PAGO: FormaPago[] = ["Efectivo", "Transferencia", "Tarjeta", "Depósito"];
const TIPOS_CON_PACIENTE: TipoEvento[] = ["Cita seguimiento directora", "Cita escolar virtual", "Cita escolar presencial", "Observación escolar", "Reporte adicional"];

interface FormState {
  id?: string;
  fecha: string;
  tipo: TipoEvento;
  nombre_paciente: string;
  forma_pago: FormaPago;
  precio_base: number | string;
  fecha_pago: string;
  monto_pagado: number | string;
  notas: string;
}

const empty: FormState = {
  fecha: new Date().toISOString().split("T")[0],
  tipo: TIPOS_CITAS[0],
  nombre_paciente: "",
  forma_pago: "Efectivo",
  precio_base: "",
  fecha_pago: "",
  monto_pagado: 0,
  notas: "",
};

export default function CitasEvaluacionesPage() {
  const [params, setParams] = useState<ParamMap>({});
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [tab, setTab] = useState<"citas" | "evaluaciones">("citas");
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth() + 1);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pagoEvento, setPagoEvento] = useState<Evento | null>(null);

  // Permisos del rol actual
  const restrictedMonth = isLimitedToCurrentMonth(user?.role);
  const canNew = canCreateEvento(user?.role);
  const canEdit = canEditEvento(user?.role);
  const canDel = canDeleteEvento(user?.role);

  // Forzar mes/año actual si el rol está restringido
  useEffect(() => {
    if (restrictedMonth) {
      const now = new Date();
      setFiltroMes(now.getMonth() + 1);
      setFiltroAnio(now.getFullYear());
    }
  }, [restrictedMonth]);

  const PRECIOS_DEFAULT: Record<TipoEvento, number> = {
    "Cita inicial / ingreso": Number(params.precio_cita_inicial ?? 1000),
    "Cita seguimiento directora": Number(params.precio_cita_seguimiento ?? 1000),
    "Cita escolar virtual": Number(params.precio_cita_escolar_virtual ?? 1500),
    "Cita escolar presencial": Number(params.precio_cita_escolar_presencial ?? 2000),
    "Observación escolar": Number(params.precio_observacion_escolar ?? 2800),
    "Reporte adicional": Number(params.precio_reporte_adicional ?? 3000),
    "Evaluación": Number(params.precio_evaluacion ?? 8500),
  };

  const load = useCallback(async () => {
    try {
      const [p, ev, pac] = await Promise.all([
        db.parametro.list("clave"),
        db.evento.list("-fecha", 500),
        db.paciente.filter({ estatus: "Activo" }, "nombre", 200),
      ]);
      setParams(paramsToObject(p));
      setEventos(ev);
      const unique = Array.from(new Map(pac.map((p) => [p.nombre.toLowerCase(), p])).values())
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPacientes(unique);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    db.auth.me().then(setUser);
  }, [load]);

  const tiposPermitidos = tab === "citas" ? TIPOS_CITAS : TIPOS_EVALUACIONES;

  const openNew = () => {
    const fechaInicial = `${filtroAnio}-${String(filtroMes).padStart(2, "0")}-01`;
    setEditing(null);
    setForm({ ...empty, fecha: fechaInicial, tipo: tiposPermitidos[0], precio_base: PRECIOS_DEFAULT[tiposPermitidos[0]] || "" });
    setShowForm(true);
  };

  const openEdit = (e: Evento) => {
    setEditing(e.id);
    setForm({
      fecha: e.fecha,
      tipo: e.tipo,
      nombre_paciente: e.nombre_paciente,
      forma_pago: e.forma_pago,
      precio_base: e.precio_base ?? "",
      fecha_pago: e.fecha_pago ?? "",
      monto_pagado: e.monto_pagado,
      notas: e.notas ?? "",
    });
    setShowForm(true);
  };

  const onTipoChange = (tipo: TipoEvento) => {
    setForm((f) => ({ ...f, tipo, precio_base: PRECIOS_DEFAULT[tipo] || "" }));
  };

  const save = async () => {
    try {
      const data = {
        fecha: form.fecha,
        tipo: form.tipo,
        nombre_paciente: form.nombre_paciente,
        forma_pago: form.forma_pago,
        precio_base: Number(form.precio_base),
        fecha_pago: form.fecha_pago || null,
        monto_pagado: Number(form.monto_pagado || 0),
        notas: form.notas || null,
        capturado_por: user?.email ?? null,
      };
      if (editing) await db.evento.update(editing, data);
      else await db.evento.create(data);
      toast.success(editing ? "Evento actualizado" : "Evento creado");
      setShowForm(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    }
  };

  const registrarPago = async (id: string, data: Partial<Evento>) => {
    try {
      await db.evento.update(id, data);
      toast.success("Pago registrado");
      setPagoEvento(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al registrar pago");
    }
  };

  const del = async (id: string) => {
    if (!confirm("¿Eliminar evento?")) return;
    try {
      await db.evento.delete(id);
      toast.success("Eliminado");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al eliminar");
    }
  };

  const parseFecha = (fecha: string | null | undefined): Date | null => {
    if (!fecha || typeof fecha !== "string" || fecha.length < 10) return null;
    const d = new Date(fecha.substring(0, 10) + "T12:00:00");
    return isNaN(d.getTime()) ? null : d;
  };
  const matchMes = (ev: Evento) => {
    const d = parseFecha(ev.fecha);
    return d != null && d.getMonth() + 1 === filtroMes && d.getFullYear() === filtroAnio;
  };
  const citas = eventos.filter((ev) => TIPOS_CITAS.includes(ev.tipo) && matchMes(ev));
  const evaluaciones = eventos.filter((ev) => TIPOS_EVALUACIONES.includes(ev.tipo) && matchMes(ev));
  const eventosMostrados = tab === "citas" ? citas : evaluaciones;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Citas y Evaluaciones</h1>
        <div className="flex items-center gap-2">
          <select
            value={filtroMes}
            onChange={(e) => setFiltroMes(Number(e.target.value))}
            disabled={restrictedMonth}
            title={restrictedMonth ? "Solo puedes capturar el mes en curso" : undefined}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
          >
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            value={filtroAnio}
            onChange={(e) => setFiltroAnio(Number(e.target.value))}
            disabled={restrictedMonth}
            className="w-24 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none disabled:bg-stone-100 disabled:text-stone-500 disabled:cursor-not-allowed"
          />
          {canNew && (
            <button onClick={openNew} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl">
              <Plus size={16} /> {tab === "citas" ? "Nueva Cita" : "Nueva Evaluación"}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-stone-100 rounded-xl p-1 w-fit">
        {([{ key: "citas", label: `Citas (${citas.length})` }, { key: "evaluaciones", label: `Evaluaciones (${evaluaciones.length})` }] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-white text-violet-700 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Paciente</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Forma Pago</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Precio Base</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IVA</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Pagado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {eventosMostrados.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-stone-400 text-sm">Sin registros</td></tr>
              ) : eventosMostrados.map((ev) => {
                const c = calcularTotalEvento(ev, params);
                return (
                  <tr key={ev.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 text-stone-600">{ev.fecha}</td>
                    <td className="px-4 py-3"><span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700">{ev.tipo}</span></td>
                    <td className="px-4 py-3 font-medium text-stone-800">{ev.nombre_paciente}</td>
                    <td className="px-4 py-3 text-stone-600">{ev.forma_pago}</td>
                    <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(c.precioBase)}</td>
                    <td className="px-4 py-3 text-right text-stone-500">{c.iva > 0 ? fmtMXN(c.iva) : "—"}</td>
                    <td className="px-4 py-3 text-right font-medium text-stone-800">{fmtMXN(c.totalEsperado)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{fmtMXN(c.montoPagado)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${c.saldo > 0 ? "text-red-600" : "text-green-600"}`}>{fmtMXN(c.saldo)}</td>
                    <td className="px-4 py-3 text-right">
                      {c.saldo > 0 && <button onClick={() => setPagoEvento(ev)} title="Registrar pago" className="text-stone-400 hover:text-green-600 mr-2"><DollarSign size={14} /></button>}
                      {canEdit && <button onClick={() => openEdit(ev)} className="text-stone-400 hover:text-violet-600 mr-2"><Edit2 size={14} /></button>}
                      {canDel && <button onClick={() => del(ev.id)} className="text-stone-400 hover:text-red-500"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pagoEvento && <PagoModal evento={pagoEvento} params={params} onClose={() => setPagoEvento(null)} onSave={registrarPago} />}

      {showForm && (
        <EventoModal
          editing={editing}
          form={form}
          setForm={setForm}
          onTipoChange={onTipoChange}
          onSave={save}
          onClose={() => setShowForm(false)}
          pacientes={pacientes}
          tiposPermitidos={tiposPermitidos}
        />
      )}
    </div>
  );
}

function EventoModal({
  editing, form, setForm, onTipoChange, onSave, onClose, pacientes, tiposPermitidos,
}: {
  editing: string | null;
  form: FormState;
  setForm: (f: FormState) => void;
  onTipoChange: (tipo: TipoEvento) => void;
  onSave: () => void;
  onClose: () => void;
  pacientes: Paciente[];
  tiposPermitidos: TipoEvento[];
}) {
  const usaDropdown = TIPOS_CON_PACIENTE.includes(form.tipo);
  const fechaObj = form.fecha ? new Date(form.fecha + "T12:00:00") : new Date();
  const mesSel = fechaObj.getMonth() + 1;
  const anioSel = fechaObj.getFullYear();

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <h2 className="font-semibold text-stone-800">{editing ? "Editar" : "Nuevo"}</h2>
          <button onClick={onClose}><X size={18} className="text-stone-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Mes</label>
              <div className="flex gap-1">
                <select value={mesSel} onChange={(e) => setForm({ ...form, fecha: `${anioSel}-${String(Number(e.target.value)).padStart(2, "0")}-01` })}
                  className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                  {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <input type="number" value={anioSel}
                  onChange={(e) => setForm({ ...form, fecha: `${Number(e.target.value)}-${String(mesSel).padStart(2, "0")}-01` })}
                  className="w-20 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Tipo</label>
              <select value={form.tipo} onChange={(e) => onTipoChange(e.target.value as TipoEvento)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {tiposPermitidos.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">{usaDropdown ? "Paciente" : "Nombre del paciente / solicitante"}</label>
            {usaDropdown ? (
              <select value={form.nombre_paciente} onChange={(e) => setForm({ ...form, nombre_paciente: e.target.value })}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                <option value="">— Seleccionar —</option>
                {pacientes.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
            ) : (
              <input value={form.nombre_paciente} onChange={(e) => setForm({ ...form, nombre_paciente: e.target.value })}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Forma de Pago</label>
              <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value as FormaPago })}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {FORMAS_PAGO.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Precio Base</label>
              <input type="number" min="0" value={form.precio_base}
                onChange={(e) => setForm({ ...form, precio_base: e.target.value })}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Fecha de Pago</label>
              <input type="date" value={form.fecha_pago} onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Monto Pagado <span className="text-stone-400 font-normal">(total recibido)</span></label>
              <input type="number" min="0" value={form.monto_pagado}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                onChange={(e) => setForm({ ...form, monto_pagado: e.target.value === "" ? 0 : Number(e.target.value) })}
                title="Monto exacto recibido (lo que entró a la cuenta tal cual, con IVA si aplica)"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Notas</label>
            <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })}
              rows={2} className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50">Cancelar</button>
          <button onClick={onSave} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-xl hover:bg-violet-700">{editing ? "Guardar" : "Crear"}</button>
        </div>
      </div>
    </div>
  );
}

function PagoModal({
  evento, params, onClose, onSave,
}: {
  evento: Evento;
  params: ParamMap;
  onClose: () => void;
  onSave: (id: string, data: Partial<Evento>) => void;
}) {
  const c = calcularTotalEvento(evento, params);

  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [monto, setMonto] = useState<number | string>(c.saldo > 0 ? c.saldo : 0);

  const handleSave = () => {
    const nuevaFechaPago = `${anio}-${String(mes).padStart(2, "0")}-01`;
    const nuevoMontoPagado = Number(evento.monto_pagado || 0) + Number(monto);
    onSave(evento.id, { fecha_pago: nuevaFechaPago, monto_pagado: nuevoMontoPagado });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <h2 className="font-semibold text-stone-800">Registrar Pago</h2>
          <button onClick={onClose}><X size={18} className="text-stone-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm">
            <p className="font-medium text-stone-700">{evento.nombre_paciente} — {evento.tipo}</p>
            <p className="text-stone-500 text-xs mt-0.5">
              Saldo pendiente: <span className="font-bold text-red-600">{fmtMXN(c.saldo)}</span>
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Mes de pago</label>
            <div className="flex gap-2">
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
                className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
                className="w-20 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Monto a abonar <span className="text-stone-400 font-normal">(total recibido)</span></label>
            <input type="number" min="0" value={monto} onFocus={(e) => (e.target as HTMLInputElement).select()}
              onChange={(e) => setMonto(e.target.value)}
              title="Monto exacto recibido (lo que entró a la cuenta tal cual, con IVA si aplica)"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-xl hover:bg-stone-50">Cancelar</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm bg-green-600 text-white rounded-xl hover:bg-green-700">Registrar Pago</button>
        </div>
      </div>
    </div>
  );
}
