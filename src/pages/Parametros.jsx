import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Check } from "lucide-react";

const DEFAULTS = [
  { clave: "precio_terapia_regular",          valor: "1100",  descripcion: "Precio por sesión de terapia regular", tipo: "dinero" },
  { clave: "precio_terapia_matutina",         valor: "900",   descripcion: "Precio por sesión de terapia matutina", tipo: "dinero" },
  { clave: "precio_cita_inicial",             valor: "1000",  descripcion: "Precio cita inicial / ingreso", tipo: "dinero" },
  { clave: "precio_cita_seguimiento",         valor: "1000",  descripcion: "Precio cita seguimiento directora", tipo: "dinero" },
  { clave: "precio_cita_escolar_virtual",     valor: "1500",  descripcion: "Precio cita escolar virtual", tipo: "dinero" },
  { clave: "precio_cita_escolar_presencial",  valor: "2000",  descripcion: "Precio cita escolar presencial", tipo: "dinero" },
  { clave: "precio_observacion_escolar",      valor: "2800",  descripcion: "Precio observación escolar", tipo: "dinero" },
  { clave: "precio_reporte_adicional",        valor: "3000",  descripcion: "Precio reporte adicional", tipo: "dinero" },
  { clave: "precio_evaluacion",               valor: "8500",  descripcion: "Precio evaluación", tipo: "dinero" },
  { clave: "iva",                             valor: "0.16",  descripcion: "Tasa de IVA (0.16 = 16%)", tipo: "porcentaje" },
  { clave: "recargo_pago_tarde",              valor: "0.10",  descripcion: "Recargo por pago tardío (0.10 = 10%)", tipo: "porcentaje" },
  { clave: "dia_tope_pago",                   valor: "10",    descripcion: "Día del mes tope para pago sin recargo", tipo: "numero" },
  { clave: "imss_patronal",                   valor: "0.30",  descripcion: "Tasa IMSS patronal (0.30 = 30%)", tipo: "porcentaje" },
  { clave: "isn_nl",                          valor: "0.03",  descripcion: "Tasa ISN Nuevo León (0.03 = 3%)", tipo: "porcentaje" },
  { clave: "isr_retenido_empleados",          valor: "0.06",  descripcion: "Tasa ISR retenido a empleados (0.06 = 6%)", tipo: "porcentaje" },
  { clave: "dias_aguinaldo",                  valor: "15",    descripcion: "Días de aguinaldo mínimos LFT", tipo: "numero" },
  { clave: "saldo_inicial_caja",              valor: "100000",descripcion: "Saldo inicial de caja (enero)", tipo: "dinero" },
];

export default function Parametros() {
  const [parametros, setParametros] = useState([]);
  const [edited, setEdited] = useState({});
  const [saved, setSaved] = useState({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const p = await base44.entities.Parametro.list();
    setParametros(p);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getValue = (clave) => {
    if (edited[clave] !== undefined) return edited[clave];
    const found = parametros.find(p => p.clave === clave);
    return found ? found.valor : (DEFAULTS.find(d => d.clave === clave)?.valor || "");
  };

  const saveParam = async (def) => {
    const valor = getValue(def.clave);
    const existing = parametros.find(p => p.clave === def.clave);
    if (existing) {
      await base44.entities.Parametro.update(existing.id, { ...existing, valor });
    } else {
      await base44.entities.Parametro.create({ clave: def.clave, valor, descripcion: def.descripcion, tipo: def.tipo });
    }
    setSaved(prev => ({ ...prev, [def.clave]: true }));
    setTimeout(() => setSaved(prev => ({ ...prev, [def.clave]: false })), 2000);
    load();
  };

  const initAll = async () => {
    for (const def of DEFAULTS) {
      const existing = parametros.find(p => p.clave === def.clave);
      if (!existing) {
        await base44.entities.Parametro.create({ clave: def.clave, valor: def.valor, descripcion: def.descripcion, tipo: def.tipo });
      }
    }
    load();
  };

  const groups = [
    { title: "Precios de Servicios", claves: DEFAULTS.slice(0,9).map(d => d.clave) },
    { title: "Tasas y Reglas de Cobro", claves: DEFAULTS.slice(9,12).map(d => d.clave) },
    { title: "Impuestos y Nómina", claves: DEFAULTS.slice(12,16).map(d => d.clave) },
    { title: "General", claves: DEFAULTS.slice(16).map(d => d.clave) },
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Parámetros</h1>
        <button onClick={initAll} className="text-sm text-violet-600 hover:text-violet-700 border border-violet-200 rounded-xl px-3 py-1.5">
          Inicializar defaults
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
        </div>
      ) : groups.map(group => (
        <div key={group.title} className="bg-white rounded-2xl border border-stone-100 shadow-sm mb-4 overflow-hidden">
          <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-600">{group.title}</h2>
          </div>
          <div className="divide-y divide-stone-50">
            {group.claves.map(clave => {
              const def = DEFAULTS.find(d => d.clave === clave);
              if (!def) return null;
              return (
                <div key={clave} className="px-5 py-3 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-stone-700">{def.descripcion}</p>
                    <p className="text-xs text-stone-400 font-mono">{clave}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      value={getValue(clave)}
                      onChange={e => setEdited(prev => ({ ...prev, [clave]: e.target.value }))}
                      className="w-28 border border-stone-200 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                    <span className="text-xs text-stone-400 w-12">
                      {def.tipo === "porcentaje" ? `${(Number(getValue(clave)) * 100).toFixed(0)}%` :
                       def.tipo === "dinero" ? "MXN" : ""}
                    </span>
                    <button onClick={() => saveParam(def)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors
                        ${saved[clave] ? "bg-green-100 text-green-600" : "bg-violet-100 text-violet-600 hover:bg-violet-200"}`}>
                      <Check size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}