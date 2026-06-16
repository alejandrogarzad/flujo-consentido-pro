"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import type { Parametro, TipoParametro } from "@/types/db";

interface ParamDef {
  clave: string;
  valor: string;
  descripcion: string;
  tipo: TipoParametro;
}

const DEFAULTS: ParamDef[] = [
  { clave: "precio_terapia_regular",         valor: "1100",   descripcion: "Precio por sesión de terapia regular", tipo: "dinero" },
  { clave: "precio_terapia_matutina",        valor: "900",    descripcion: "Precio por sesión de terapia matutina", tipo: "dinero" },
  { clave: "precio_cita_inicial",            valor: "1000",   descripcion: "Precio cita inicial / ingreso", tipo: "dinero" },
  { clave: "precio_cita_seguimiento",        valor: "1000",   descripcion: "Precio cita seguimiento directora", tipo: "dinero" },
  { clave: "precio_cita_escolar_virtual",    valor: "1500",   descripcion: "Precio cita escolar virtual", tipo: "dinero" },
  { clave: "precio_cita_escolar_presencial", valor: "2000",   descripcion: "Precio cita escolar presencial", tipo: "dinero" },
  { clave: "precio_observacion_escolar",     valor: "2800",   descripcion: "Precio observación escolar", tipo: "dinero" },
  { clave: "precio_reporte_adicional",       valor: "3000",   descripcion: "Precio reporte adicional", tipo: "dinero" },
  { clave: "precio_evaluacion",              valor: "8500",   descripcion: "Precio evaluación", tipo: "dinero" },
  { clave: "precio_safe_and_sound",          valor: "0",      descripcion: "Precio programa Safe and Sound", tipo: "dinero" },
  { clave: "iva",                            valor: "0.16",   descripcion: "Tasa de IVA (0.16 = 16%)", tipo: "porcentaje" },
  { clave: "recargo_pago_tarde",             valor: "0.10",   descripcion: "Recargo por pago tardío (0.10 = 10%)", tipo: "porcentaje" },
  { clave: "dia_tope_pago",                  valor: "10",     descripcion: "Día del mes tope para pago sin recargo", tipo: "numero" },
  { clave: "imss_patronal",                  valor: "0.30",   descripcion: "Tasa IMSS patronal (0.30 = 30%)", tipo: "porcentaje" },
  { clave: "isn_nl",                         valor: "0.03",   descripcion: "Tasa ISN Nuevo León (0.03 = 3%)", tipo: "porcentaje" },
  { clave: "isr_retenido_empleados",         valor: "0.06",   descripcion: "Tasa ISR retenido a empleados (0.06 = 6%)", tipo: "porcentaje" },
  { clave: "dias_aguinaldo",                 valor: "15",     descripcion: "Días de aguinaldo mínimos LFT", tipo: "numero" },
  { clave: "saldo_inicial_caja",             valor: "100000", descripcion: "Saldo inicial de caja (enero)", tipo: "dinero" },
  { clave: "anio_actual",                    valor: String(new Date().getFullYear()), descripcion: "Año contable activo", tipo: "numero" },
];

const GROUPS: { title: string; claves: string[] }[] = [
  { title: "Precios de Servicios",     claves: DEFAULTS.slice(0, 10).map((d) => d.clave) },
  { title: "Tasas y Reglas de Cobro",  claves: DEFAULTS.slice(10, 13).map((d) => d.clave) },
  { title: "Impuestos y Nómina",       claves: DEFAULTS.slice(13, 17).map((d) => d.clave) },
  { title: "General",                  claves: DEFAULTS.slice(17).map((d) => d.clave) },
];

export default function ParametrosPage() {
  const [parametros, setParametros] = useState<Parametro[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await db.parametro.list("clave");
      setParametros(rows);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar parámetros");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = db.parametro.subscribe(() => load());
    return unsubscribe;
  }, [load]);

  const getValue = (clave: string): string => {
    if (edited[clave] !== undefined) return edited[clave];
    const found = parametros.find((p) => p.clave === clave);
    return found ? found.valor : DEFAULTS.find((d) => d.clave === clave)?.valor ?? "";
  };

  const saveParam = async (def: ParamDef) => {
    const valor = getValue(def.clave);
    setSavingKey(def.clave);
    try {
      const existing = parametros.find((p) => p.clave === def.clave);
      if (existing) {
        await db.parametro.update(existing.id, { valor });
      } else {
        await db.parametro.create({
          clave: def.clave,
          valor,
          descripcion: def.descripcion,
          tipo: def.tipo,
        });
      }
      setSaved((prev) => ({ ...prev, [def.clave]: true }));
      setTimeout(() => setSaved((prev) => ({ ...prev, [def.clave]: false })), 2000);
      toast.success(`${def.descripcion} guardado`);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setSavingKey(null);
    }
  };

  const initAll = async () => {
    setInitializing(true);
    let inserted = 0;
    try {
      for (const def of DEFAULTS) {
        const existing = parametros.find((p) => p.clave === def.clave);
        if (!existing) {
          await db.parametro.create({
            clave: def.clave,
            valor: def.valor,
            descripcion: def.descripcion,
            tipo: def.tipo,
          });
          inserted++;
        }
      }
      toast.success(inserted === 0 ? "Todos los parámetros ya existen" : `Inicializados ${inserted} parámetros`);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al inicializar");
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Parámetros</h1>
        <button
          onClick={initAll}
          disabled={initializing || loading}
          className="text-sm text-violet-600 hover:text-violet-700 border border-violet-200 rounded-xl px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {initializing && <Loader2 size={12} className="animate-spin" />}
          Inicializar defaults
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
        </div>
      ) : (
        GROUPS.map((group) => (
          <div
            key={group.title}
            className="bg-white rounded-2xl border border-stone-100 shadow-sm mb-4 overflow-hidden"
          >
            <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
              <h2 className="text-sm font-semibold text-stone-600">{group.title}</h2>
            </div>
            <div className="divide-y divide-stone-50">
              {group.claves.map((clave) => {
                const def = DEFAULTS.find((d) => d.clave === clave);
                if (!def) return null;
                const isSaving = savingKey === clave;
                const isSaved = saved[clave];
                const valor = getValue(clave);
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
                        value={valor}
                        onChange={(e) =>
                          setEdited((prev) => ({ ...prev, [clave]: e.target.value }))
                        }
                        className="w-28 border border-stone-200 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                      <span className="text-xs text-stone-400 w-12">
                        {def.tipo === "porcentaje"
                          ? `${(Number(valor) * 100).toFixed(0)}%`
                          : def.tipo === "dinero"
                          ? "MXN"
                          : ""}
                      </span>
                      <button
                        onClick={() => saveParam(def)}
                        disabled={isSaving}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50
                          ${isSaved
                            ? "bg-green-100 text-green-600"
                            : "bg-violet-100 text-violet-600 hover:bg-violet-200"}`}
                      >
                        {isSaving ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
