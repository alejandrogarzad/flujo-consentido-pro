import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { calcularTotalEvento, eventoUsaTotalConIva, paramsToObject, fmtMXN } from "@/lib/calculos";
import { Plus, X, Edit2, Trash2, DollarSign } from "lucide-react";

const TIPOS_CITAS = ["Cita inicial / ingreso","Cita seguimiento directora","Cita escolar virtual","Cita escolar presencial","Observación escolar","Reporte adicional"];
const TIPOS_EVALUACIONES = ["Evaluación"];
const TIPOS = [...TIPOS_CITAS, ...TIPOS_EVALUACIONES];
const FORMAS_PAGO = ["Efectivo","Transferencia","Tarjeta","Depósito"];

// Tipos donde se usa dropdown de pacientes activos
const TIPOS_CON_PACIENTE = ["Cita seguimiento directora","Cita escolar virtual","Cita escolar presencial","Observación escolar","Reporte adicional"];

// Tipos que solo requieren mes (no fecha exacta) — todos
const TIPOS_SOLO_MES = ["Cita inicial / ingreso","Cita seguimiento directora","Cita escolar virtual","Cita escolar presencial","Observación escolar","Reporte adicional","Evaluación"];

const MESES_LABEL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const empty = { fecha: new Date().toISOString().split("T")[0], tipo: TIPOS[0], nombre_paciente: "", forma_pago: "Efectivo", precio_base: "", fecha_pago: "", monto_pagado: 0, notas: "" };

function EventoModal({ editing, form, setForm, onTipoChange, onSave, onClose, pacientes, tiposPermitidos }) {
  const usaDropdown = TIPOS_CON_PACIENTE.includes(form.tipo);
  const soloMes = TIPOS_SOLO_MES.includes(form.tipo);
  const totalConIva = eventoUsaTotalConIva(form);

  // Para tipos solo-mes: extrae mes y año de la fecha guardada
  const fechaObj = form.fecha ? new Date(form.fecha + "T12:00:00") : new Date();
  const mesSel = fechaObj.getMonth() + 1;
  const anioSel = fechaObj.getFullYear();

  const onMesChange = (mes) => {
    const anio = anioSel;
    setForm({ ...form, fecha: `${anio}-${String(mes).padStart(2,"0")}-01` });
  };
  const onAnioChange = (anio) => {
    setForm({ ...form, fecha: `${anio}-${String(mesSel).padStart(2,"0")}-01` });
  };

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
              <label className="text-xs font-medium text-stone-500 block mb-1">{soloMes ? "Mes" : "Fecha"}</label>
              {soloMes ? (
                <div className="flex gap-1">
                  <select value={mesSel} onChange={e => onMesChange(Number(e.target.value))}
                    className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                    {MESES_LABEL.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                  <input type="number" value={anioSel} onChange={e => onAnioChange(Number(e.target.value))}
                    className="w-20 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                </div>
              ) : (
                <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Tipo</label>
              <select value={form.tipo} onChange={e => onTipoChange(e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {tiposPermitidos.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">
              {usaDropdown ? "Paciente" : "Nombre del paciente / solicitante"}
            </label>
            {usaDropdown ? (
              <select value={form.nombre_paciente} onChange={e => setForm({...form, nombre_paciente: e.target.value})}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                <option value="">— Seleccionar paciente —</option>
                {pacientes.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
            ) : (
              <input value={form.nombre_paciente} onChange={e => setForm({...form, nombre_paciente: e.target.value})}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Forma de Pago</label>
              <select value={form.forma_pago} onChange={e => setForm({...form, forma_pago: e.target.value})}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {FORMAS_PAGO.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Precio Base</label>
              <input type="number" min="0" value={form.precio_base}
                onChange={e => setForm({...form, precio_base: e.target.value})}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">Fecha de Pago (Mes/Año)</label>
              <div className="flex gap-1">
                <select
                  value={form.fecha_pago ? new Date(form.fecha_pago + "T12:00:00").getMonth() + 1 : ""}
                  onChange={e => {
                    const mes = Number(e.target.value);
                    const anio = form.fecha_pago ? new Date(form.fecha_pago + "T12:00:00").getFullYear() : new Date().getFullYear();
                    setForm({...form, fecha_pago: mes ? `${anio}-${String(mes).padStart(2,"0")}-01` : ""});
                  }}
                  className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                  <option value="">— Mes —</option>
                  {MESES_LABEL.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <input type="number"
                 value={form.fecha_pago ? new Date(form.fecha_pago + "T12:00:00").getFullYear() : ""}
                 placeholder="Año"
                 onChange={e => {
                   if (!e.target.value) return;
                   const anio = Number(e.target.value);
                   const mes = form.fecha_pago ? new Date(form.fecha_pago + "T12:00:00").getMonth() + 1 : new Date().getMonth() + 1;
                   setForm({...form, fecha_pago: `${anio}-${String(mes).padStart(2,"0")}-01`});
                 }}
                 className="w-20 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-stone-500 block mb-1">
                Monto Pagado {totalConIva ? <span className="text-stone-400 font-normal">(total recibido)</span> : <span className="text-stone-400 font-normal">(sin IVA)</span>}
              </label>
              <input type="number" min="0" value={form.monto_pagado ?? 0}
                onFocus={e => e.target.select()}
                onChange={e => setForm({...form, monto_pagado: e.target.value === "" ? 0 : Number(e.target.value)})}
                title={totalConIva ? "Monto neto recibido (lo que efectivamente entró a la cuenta, ya con IVA si aplica)" : "Subtotal sin IVA (convención previa a mayo 2026)"}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Notas</label>
            <textarea value={form.notas || ""} onChange={e => setForm({...form, notas: e.target.value})}
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

function TablaEventos({ eventos, params, onEdit, onDel, onPago }) {
  return (
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
              <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500" title="Solo aplica a eventos previos a mayo 2026 (convención sin IVA)">Con IVA <span className="text-stone-300 font-normal">(hist.)</span></th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {eventos.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-stone-400 text-sm">Sin registros</td></tr>
            ) : eventos.map(ev => {
              const c = calcularTotalEvento(ev, params);
              return (
                <tr key={ev.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3 text-stone-600">{ev.fecha}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700">{ev.tipo}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-stone-800">{ev.nombre_paciente}</td>
                  <td className="px-4 py-3 text-stone-600">{ev.forma_pago}</td>
                  <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(c.precioBase)}</td>
                  <td className="px-4 py-3 text-right text-stone-500">{c.iva > 0 ? fmtMXN(c.iva) : "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-stone-800">{fmtMXN(c.totalEsperado)}</td>
                  <td className="px-4 py-3 text-right text-green-600">{fmtMXN(c.montoPagado)}</td>
                  <td className="px-4 py-3 text-right text-stone-700">{c.montoPagadoConIva !== c.montoPagado ? fmtMXN(c.montoPagadoConIva) : "—"}</td>
                  <td className={`px-4 py-3 text-right font-medium ${c.saldo > 0 ? "text-red-600" : "text-green-600"}`}>{fmtMXN(c.saldo)}</td>
                  <td className="px-4 py-3 text-right">
                    {c.saldo > 0 && (
                      <button onClick={() => onPago(ev)} title="Registrar pago pendiente" className="text-stone-400 hover:text-green-600 mr-2"><DollarSign size={14} /></button>
                    )}
                    <button onClick={() => onEdit(ev)} className="text-stone-400 hover:text-violet-600 mr-2"><Edit2 size={14} /></button>
                    <button onClick={() => onDel(ev.id)} className="text-stone-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PagoModal({ evento, params, onClose, onSave }) {
  const c = calcularTotalEvento(evento, params);
  const ivaRate = Number(params.iva || 0.16);
  const conIva = evento.forma_pago !== "Efectivo";
  // En nueva convención (mayo+) el monto a capturar = saldo tal cual (es total).
  // En la anterior, hay que expresarlo "sin IVA" porque así se guarda.
  const sugerido = (c.totalConIva || !conIva) ? c.saldo : Math.round(c.saldo / (1 + ivaRate));

  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [monto, setMonto] = useState(sugerido > 0 ? sugerido : 0);

  const handleSave = () => {
    const nuevaFechaPago = `${anio}-${String(mes).padStart(2,"0")}-01`;
    const nuevoMontoPagado = Number(evento.monto_pagado || 0) + Number(monto);
    onSave(evento.id, { fecha_pago: nuevaFechaPago, monto_pagado: nuevoMontoPagado });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <h2 className="font-semibold text-stone-800">Registrar Pago Pendiente</h2>
          <button onClick={onClose}><X size={18} className="text-stone-400" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm">
            <p className="font-medium text-stone-700">{evento.nombre_paciente} — {evento.tipo}</p>
            <p className="text-stone-500 text-xs mt-0.5">
              Saldo pendiente: <span className="font-bold text-red-600">{fmtMXN(c.saldo)}</span>
              {conIva && !c.totalConIva && <span className="ml-1 text-stone-400">(captura sin IVA: {fmtMXN(sugerido)})</span>}
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">Mes de pago</label>
            <div className="flex gap-2">
              <select value={mes} onChange={e => setMes(Number(e.target.value))}
                className="flex-1 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
                {MESES_LABEL.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
              </select>
              <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))}
                className="w-20 border border-stone-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1">
              Monto a abonar {conIva && !c.totalConIva ? "(sin IVA)" : c.totalConIva ? "(total recibido)" : ""}
            </label>
            <input type="number" min="0" value={monto} onFocus={e => e.target.select()}
              onChange={e => setMonto(e.target.value)}
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

export default function CitasEvaluaciones() {
  const [params, setParams] = useState({});
  const [eventos, setEventos] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [tab, setTab] = useState("citas");
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth() + 1);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [pagoEvento, setPagoEvento] = useState(null); // evento con saldo pendiente a pagar

  const PRECIOS_DEFAULT = {
    "Cita inicial / ingreso": params.precio_cita_inicial || 1000,
    "Cita seguimiento directora": params.precio_cita_seguimiento || 1000,
    "Cita escolar virtual": params.precio_cita_escolar_virtual || 1500,
    "Cita escolar presencial": params.precio_cita_escolar_presencial || 2000,
    "Observación escolar": params.precio_observacion_escolar || 2800,
    "Reporte adicional": params.precio_reporte_adicional || 3000,
    "Evaluación": params.precio_evaluacion || 8500,
  };

  const load = () => {
    Promise.all([
      base44.entities.Parametro.list(),
      base44.entities.Evento.list("-fecha", 500),
      base44.entities.Paciente.filter({ estatus: "Activo" }, "nombre", 200),
    ]).then(([p, ev, pac]) => {
      setParams(paramsToObject(p));
      setEventos(ev);
      // Deduplicar pacientes por nombre
      const unique = Array.from(new Map(pac.map(p => [p.nombre.toLowerCase(), p])).values())
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      setPacientes(unique);
      setLoading(false);
    });
  };

  useEffect(() => { load(); base44.auth.me().then(setUser); }, []);

  const tiposPermitidos = tab === "citas" ? TIPOS_CITAS : TIPOS_EVALUACIONES;

  const openNew = () => {
    const fechaInicial = `${filtroAnio}-${String(filtroMes).padStart(2,"0")}-01`;
    const newForm = { ...empty, fecha: fechaInicial, tipo: tiposPermitidos[0], precio_base: PRECIOS_DEFAULT[tiposPermitidos[0]] || "" };
    setEditing(null);
    setForm(newForm);
    setShowForm(true);
  };

  const openEdit = (e) => { setEditing(e.id); setForm(e); setShowForm(true); };

  const onTipoChange = (tipo) => {
    setForm(f => ({ ...f, tipo, precio_base: PRECIOS_DEFAULT[tipo] || "" }));
  };

  const save = async () => {
    const { id, ...formSinId } = form;
    const data = { ...formSinId, precio_base: Number(form.precio_base), monto_pagado: Number(form.monto_pagado || 0), capturado_por: user?.email };
    if (editing) await base44.entities.Evento.update(editing, data);
    else await base44.entities.Evento.create(data);
    setShowForm(false);
    load();
  };

  const registrarPago = async (id, data) => {
    await base44.entities.Evento.update(id, data);
    setPagoEvento(null);
    load();
  };

  const del = async (id) => {
    if (!confirm("¿Eliminar evento?")) return;
    try {
      await base44.entities.Evento.delete(id);
    } catch (e) {
      // Registro ya no existe, ignorar
    }
    load();
  };

  const parseFecha = (fecha) => new Date(fecha.substring(0, 10) + "T12:00:00");
  const citas = eventos.filter(ev => TIPOS_CITAS.includes(ev.tipo) && parseFecha(ev.fecha).getMonth() + 1 === filtroMes && parseFecha(ev.fecha).getFullYear() === filtroAnio);
  const evaluaciones = eventos.filter(ev => TIPOS_EVALUACIONES.includes(ev.tipo) && parseFecha(ev.fecha).getMonth() + 1 === filtroMes && parseFecha(ev.fecha).getFullYear() === filtroAnio);
  const eventosMostrados = tab === "citas" ? citas : evaluaciones;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Citas y Evaluaciones</h1>
        <div className="flex items-center gap-2">
          <select value={filtroMes} onChange={e => setFiltroMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"].map((m,i) => (
              <option key={i} value={i+1}>{m}</option>
            ))}
          </select>
          <input type="number" value={filtroAnio} onChange={e => setFiltroAnio(Number(e.target.value))}
            className="w-20 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          <button onClick={openNew} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl">
            <Plus size={16} /> {tab === "citas" ? "Nueva Cita" : "Nueva Evaluación"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-stone-100 rounded-xl p-1 w-fit">
        {[
          { key: "citas", label: `Citas (${citas.length})` },
          { key: "evaluaciones", label: `Evaluaciones (${evaluaciones.length})` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? "bg-white text-violet-700 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
            {label}
          </button>
        ))}
      </div>

      <TablaEventos eventos={eventosMostrados} params={params} onEdit={openEdit} onDel={del} onPago={ev => setPagoEvento(ev)} />

      {pagoEvento && (
        <PagoModal
          evento={pagoEvento}
          params={params}
          onClose={() => setPagoEvento(null)}
          onSave={registrarPago}
        />
      )}

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