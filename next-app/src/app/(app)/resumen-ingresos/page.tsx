"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { fmtMXN, MESES, getAnioActual, paramsToObject } from "@/lib/calculos";

const CATS = [
  { key: "terapias", label: "Terapias" },
  { key: "citas", label: "Citas" },
  { key: "evaluaciones", label: "Evaluaciones" },
  { key: "subarrendamiento", label: "Subarrendamiento" },
  { key: "otros", label: "Otros" },
] as const;

type CatKey = (typeof CATS)[number]["key"];

interface EditState {
  id: string | null;
  terapias: number;
  citas: number;
  evaluaciones: number;
  subarrendamiento: number;
  otros: number;
  notas: string;
}

export default function ResumenIngresosPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);

  const [terapiasPorMes, setTerapiasPorMes] = useState<number[]>(Array(12).fill(0));
  const [citasPorMes, setCitasPorMes] = useState<number[]>(Array(12).fill(0));
  const [evaluacionesPorMes, setEvaluacionesPorMes] = useState<number[]>(Array(12).fill(0));
  const [subarrPorMes, setSubarrPorMes] = useState<number[]>(Array(12).fill(0));

  const cargar = useCallback(async () => {
    try {
      // listAll() pagina internamente; .list() cae al cap de 1000 de Supabase.
      const [params, resumen, pagos, eventos, subarr] = await Promise.all([
        db.parametro.list("clave"),
        db.resumen_ingreso.filter({ anio }),
        db.pago_terapia.listAll("-created_date"),
        db.evento.listAll(),
        db.subarrendamiento.listAll(),
      ]);
      const anioFromParams = getAnioActual(params);
      if (anio !== anioFromParams) {
        // sincroniza si el usuario aún no ha tocado el filtro
      }
      void paramsToObject(params);

      const ter = Array(12).fill(0);
      pagos.filter((p) => p.mes && (p.anio === anio || !p.anio)).forEach((p) => {
        ter[p.mes - 1] += Number(p.monto_pagado || 0);
      });

      const TIPOS_EVAL = ["Evaluación"];
      const TIPOS_CITAS = ["Cita inicial / ingreso", "Cita seguimiento directora", "Cita escolar virtual", "Cita escolar presencial", "Observación escolar", "Reporte adicional"];
      const cit = Array(12).fill(0);
      const eva = Array(12).fill(0);
      eventos.forEach((ev) => {
        if (!ev.fecha || ev.fecha.length < 10) return;
        const fechaStr = ev.fecha.substring(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return;
        const d = new Date(fechaStr + "T12:00:00");
        if (isNaN(d.getTime()) || d.getFullYear() !== anio) return;
        if (TIPOS_EVAL.includes(ev.tipo)) eva[d.getMonth()] += Number(ev.monto_pagado || 0);
        else if (TIPOS_CITAS.includes(ev.tipo)) cit[d.getMonth()] += Number(ev.monto_pagado || 0);
      });

      const sub = Array(12).fill(0);
      subarr.filter((s) => s.mes && (s.anio === anio || !s.anio)).forEach((s) => {
        sub[s.mes - 1] += Number(s.monto_cobrado || 0);
      });

      setTerapiasPorMes(ter);
      setCitasPorMes(cit);
      setEvaluacionesPorMes(eva);
      setSubarrPorMes(sub);

      const porMes: Record<number, (typeof resumen)[number]> = {};
      resumen.forEach((r) => { porMes[r.mes] = r; });

      const nuevosEdits: Record<number, EditState> = {};
      for (let m = 1; m <= 12; m++) {
        if (porMes[m]) {
          nuevosEdits[m] = {
            id: porMes[m].id,
            terapias: Math.round(ter[m - 1]),
            citas: Math.round(cit[m - 1]),
            evaluaciones: Math.round(eva[m - 1]),
            subarrendamiento: Math.round(sub[m - 1]),
            otros: Number(porMes[m].otros || 0),
            notas: porMes[m].notas || "",
          };
        } else {
          nuevosEdits[m] = {
            id: null,
            terapias: Math.round(ter[m - 1]),
            citas: Math.round(cit[m - 1]),
            evaluaciones: Math.round(eva[m - 1]),
            subarrendamiento: Math.round(sub[m - 1]),
            otros: 0,
            notas: "",
          };
        }
      }
      setEdits(nuevosEdits);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar");
    }
  }, [anio]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const setEdit = <K extends keyof EditState>(mes: number, campo: K, valor: EditState[K]) => {
    setEdits((prev) => ({ ...prev, [mes]: { ...prev[mes], [campo]: valor } }));
  };

  const sincronizar = () => {
    setEdits((prev) => {
      const nuevo = { ...prev };
      for (let m = 1; m <= 12; m++) {
        nuevo[m] = {
          ...nuevo[m],
          terapias: Math.round(terapiasPorMes[m - 1]),
          citas: Math.round(citasPorMes[m - 1]),
          evaluaciones: Math.round(evaluacionesPorMes[m - 1]),
          subarrendamiento: Math.round(subarrPorMes[m - 1]),
        };
      }
      return nuevo;
    });
    toast.success("Sincronizado");
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      for (let m = 1; m <= 12; m++) {
        const e = edits[m];
        if (!e) continue;
        const data = {
          anio, mes: m,
          terapias: Number(e.terapias || 0),
          citas: Number(e.citas || 0),
          evaluaciones: Number(e.evaluaciones || 0),
          subarrendamiento: Number(e.subarrendamiento || 0),
          otros: Number(e.otros || 0),
          notas: e.notas || "",
        };
        if (e.id) {
          await db.resumen_ingreso.update(e.id, data);
        } else {
          const r = await db.resumen_ingreso.create(data);
          setEdits((prev) => ({ ...prev, [m]: { ...prev[m], id: r.id } }));
        }
      }
      setOk(true);
      toast.success("Guardado");
      setTimeout(() => setOk(false), 3000);
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setGuardando(false);
    }
  };

  const totalPorMes = (m: number) => {
    const e = edits[m] || {} as EditState;
    return Number(e.terapias || 0) + Number(e.citas || 0) + Number(e.evaluaciones || 0) + Number(e.subarrendamiento || 0) + Number(e.otros || 0);
  };
  const totalAnual = Array.from({ length: 12 }, (_, i) => totalPorMes(i + 1)).reduce((a, b) => a + b, 0);
  const totalCat = (key: CatKey) =>
    Array.from({ length: 12 }, (_, i) => Number((edits[i + 1] as any)?.[key] || 0)).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Resumen de Ingresos {anio}</h1>
          <p className="text-xs text-stone-400 mt-0.5">Edita manualmente cada celda. Los valores se pre-llenan desde los registros del sistema.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          <button onClick={sincronizar}
            className="flex items-center gap-2 border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm font-medium px-4 py-2 rounded-xl">
            <RefreshCw size={14} /> Sincronizar
          </button>
          {ok && <span className="text-green-600 text-sm font-medium">✓ Guardado</span>}
          <button onClick={guardar} disabled={guardando}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl">
            <Save size={14} /> {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {CATS.map((c) => (
          <div key={c.key} className="bg-white rounded-2xl border border-stone-100 p-4 shadow-sm">
            <p className="text-xs text-stone-400 mb-1">{c.label}</p>
            <p className="text-lg font-bold text-violet-700">{fmtMXN(totalCat(c.key))}</p>
          </div>
        ))}
      </div>

      <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4 mb-6 flex items-center justify-between">
        <span className="text-sm font-semibold text-stone-700">Total Anual</span>
        <span className="text-2xl font-bold text-violet-700">{fmtMXN(totalAnual)}</span>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500 w-28">Mes</th>
                {CATS.map((c) => <th key={c.key} className="px-3 py-3 text-right text-xs font-semibold text-stone-500">{c.label}</th>)}
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Notas</th>
              </tr>
            </thead>
            <tbody>
              {MESES.map((mes, i) => {
                const m = i + 1;
                const e = edits[m] || {} as EditState;
                return (
                  <tr key={m} className="border-t border-stone-50 hover:bg-stone-50/30">
                    <td className="px-4 py-2.5 font-medium text-stone-700">{mes}</td>
                    {CATS.map((c) => (
                      <td key={c.key} className="px-2 py-2">
                        <input type="number" min="0"
                          value={(e as any)[c.key] ?? 0}
                          onFocus={(ev) => (ev.target as HTMLInputElement).select()}
                          onChange={(ev) => setEdit(m, c.key as keyof EditState, Number(ev.target.value) as any)}
                          className="w-28 border border-stone-200 rounded-lg px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-bold text-violet-700">{fmtMXN(totalPorMes(m))}</td>
                    <td className="px-3 py-2">
                      <input value={e.notas || ""} onChange={(ev) => setEdit(m, "notas", ev.target.value)}
                        placeholder="—"
                        className="w-36 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-stone-50 border-t-2 border-stone-200">
              <tr>
                <td className="px-4 py-3 font-bold text-stone-700">Total</td>
                {CATS.map((c) => <td key={c.key} className="px-3 py-3 text-right font-bold text-stone-700">{fmtMXN(totalCat(c.key))}</td>)}
                <td className="px-4 py-3 text-right font-bold text-violet-700">{fmtMXN(totalAnual)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
