import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtMXN, MESES } from "@/lib/calculos";
import { Save, RefreshCw } from "lucide-react";

const ANIO = 2026;
const CATS = [
  { key: "terapias",        label: "Terapias" },
  { key: "citas",           label: "Citas" },
  { key: "evaluaciones",    label: "Evaluaciones" },
  { key: "subarrendamiento", label: "Subarrendamiento" },
  { key: "otros",           label: "Otros" },
];

function emptyRow(mes) {
  return { mes, anio: ANIO, terapias: 0, citas: 0, evaluaciones: 0, subarrendamiento: 0, otros: 0, notas: "" };
}

export default function ResumenIngresos() {
  const [filas, setFilas]       = useState([]);   // datos de BD (array 12)
  const [edits, setEdits]       = useState({});   // { mes: { terapias, citas_evaluaciones, subarrendamiento, otros, notas } }
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk]             = useState(false);

  // Datos calculados desde otras entidades
  const [terapiasPorMes, setTerapiasPorMes]         = useState(Array(12).fill(0));
  const [citasPorMes, setCitasPorMes]               = useState(Array(12).fill(0));
  const [evaluacionesPorMes, setEvaluacionesPorMes] = useState(Array(12).fill(0));
  const [subarrPorMes, setSubarrPorMes]             = useState(Array(12).fill(0));

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    const [resumen, pagos, eventos, subarr] = await Promise.all([
      base44.entities.ResumenIngreso.filter({ anio: ANIO }),
      base44.entities.PagoTerapia.list("-created_date", 500),
      base44.entities.Evento.list(),
      base44.entities.Subarrendamiento.list(),
    ]);

    // Calcular automáticos por mes
    const ter = Array(12).fill(0);
    pagos.filter(p => p.mes && (p.anio === ANIO || !p.anio))
      .forEach(p => { ter[p.mes - 1] += Number(p.monto_pagado || 0); });
    // monto_pagado ya es el valor capturado sin IVA, se suma directo

    const TIPOS_EVALUACIONES = ["Evaluación"];
    const TIPOS_CITAS_VALIDOS = [
      "Cita inicial / ingreso", "Cita seguimiento directora",
      "Cita escolar virtual", "Cita escolar presencial",
      "Observación escolar", "Reporte adicional"
    ];
    const cit = Array(12).fill(0);
    const eva = Array(12).fill(0);
    eventos.forEach(ev => {
      // Ignorar eventos con fecha vacía o inválida
      if (!ev.fecha || ev.fecha.length < 10) return;
      const fechaStr = ev.fecha.substring(0, 10);
      // Ignorar fechas corruptas (ej: "0-NaN-01")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return;
      const d = new Date(fechaStr + "T12:00:00");
      if (isNaN(d.getTime()) || d.getFullYear() !== ANIO) return;
      // Solo contar tipos válidos del sistema actual
      if (TIPOS_EVALUACIONES.includes(ev.tipo)) {
        eva[d.getMonth()] += Number(ev.monto_pagado || 0);
      } else if (TIPOS_CITAS_VALIDOS.includes(ev.tipo)) {
        cit[d.getMonth()] += Number(ev.monto_pagado || 0);
      }
    });

    const sub = Array(12).fill(0);
    subarr.filter(s => s.mes && (s.anio === ANIO || !s.anio))
      .forEach(s => { sub[s.mes - 1] += Number(s.monto_cobrado || 0); });

    setTerapiasPorMes(ter);
    setCitasPorMes(cit);
    setEvaluacionesPorMes(eva);
    setSubarrPorMes(sub);

    // Inicializar edits desde BD (si existe registro) o desde calculados
    const porMes = {};
    resumen.forEach(r => { porMes[r.mes] = r; });

    const nuevosEdits = {};
    for (let m = 1; m <= 12; m++) {
      if (porMes[m]) {
        nuevosEdits[m] = {
          id: porMes[m].id,
          // Terapias, citas, evaluaciones y subarrendamiento siempre se recalculan desde el sistema
          terapias:        Math.round(ter[m - 1]),
          citas:           Math.round(cit[m - 1]),
          evaluaciones:    Math.round(eva[m - 1]),
          subarrendamiento: Math.round(sub[m - 1]),
          // "Otros" y notas se respetan del registro guardado en BD
          otros:           Number(porMes[m].otros || 0),
          notas:           porMes[m].notas || "",
        };
      } else {
        // Pre-llenar con calculados
        nuevosEdits[m] = {
          id: null,
          terapias:        Math.round(ter[m - 1]),
          citas:           Math.round(cit[m - 1]),
          evaluaciones:    Math.round(eva[m - 1]),
          subarrendamiento: Math.round(sub[m - 1]),
          otros:           0,
          notas:           "",
        };
      }
    }
    setEdits(nuevosEdits);
    setFilas(resumen);
  };

  const setEdit = (mes, campo, valor) => {
    setEdits(prev => ({ ...prev, [mes]: { ...prev[mes], [campo]: valor } }));
  };

  const sincronizar = () => {
    // Rellenar todas las filas con los datos calculados automáticamente
    setEdits(prev => {
      const nuevo = { ...prev };
      for (let m = 1; m <= 12; m++) {
        nuevo[m] = {
          ...nuevo[m],
          terapias:        Math.round(terapiasPorMes[m - 1]),
          citas:           Math.round(citasPorMes[m - 1]),
          evaluaciones:    Math.round(evaluacionesPorMes[m - 1]),
          subarrendamiento: Math.round(subarrPorMes[m - 1]),
        };
      }
      return nuevo;
    });
  };

  const guardar = async () => {
    setGuardando(true);
    const ops = [];
    for (let m = 1; m <= 12; m++) {
      const e = edits[m];
      if (!e) continue;
      const data = {
        anio: ANIO, mes: m,
        terapias:        Number(e.terapias || 0),
        citas:           Number(e.citas || 0),
        evaluaciones:    Number(e.evaluaciones || 0),
        subarrendamiento: Number(e.subarrendamiento || 0),
        otros:           Number(e.otros || 0),
        notas:           e.notas || "",
      };
      if (e.id) {
        ops.push(base44.entities.ResumenIngreso.update(e.id, data));
      } else {
        ops.push(base44.entities.ResumenIngreso.create(data).then(r => {
          setEdits(prev => ({ ...prev, [m]: { ...prev[m], id: r.id } }));
        }));
      }
    }
    await Promise.all(ops);
    setGuardando(false);
    setOk(true);
    setTimeout(() => setOk(false), 3000);
  };

  // Totales por mes
  const totalPorMes = m => {
    const e = edits[m] || {};
    return (Number(e.terapias || 0) + Number(e.citas || 0) + Number(e.evaluaciones || 0) +
            Number(e.subarrendamiento || 0) + Number(e.otros || 0));
  };

  const totalAnual = Array.from({ length: 12 }, (_, i) => totalPorMes(i + 1)).reduce((a, b) => a + b, 0);

  const totalCat = (key) =>
    Array.from({ length: 12 }, (_, i) => Number(edits[i + 1]?.[key] || 0)).reduce((a, b) => a + b, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Resumen de Ingresos {ANIO}</h1>
          <p className="text-xs text-stone-400 mt-0.5">Edita manualmente cada celda. Los valores se pre-llenan desde los registros del sistema.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={sincronizar}
            className="flex items-center gap-2 border border-stone-200 text-stone-600 hover:bg-stone-50 text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <RefreshCw size={14} /> Sincronizar desde sistema
          </button>
          {ok && <span className="text-green-600 text-sm font-medium">✓ Guardado</span>}
          <button onClick={guardar} disabled={guardando}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
            <Save size={14} /> {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>

      {/* KPI resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {CATS.map(c => (
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

      {/* Tabla editable por mes */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500 w-28">Mes</th>
                {CATS.map(c => (
                  <th key={c.key} className="px-3 py-3 text-right text-xs font-semibold text-stone-500">{c.label}</th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Notas</th>
              </tr>
            </thead>
            <tbody>
              {MESES.map((mes, i) => {
                const m = i + 1;
                const e = edits[m] || {};
                const total = totalPorMes(m);
                return (
                  <tr key={m} className="border-t border-stone-50 hover:bg-stone-50/30">
                    <td className="px-4 py-2.5 font-medium text-stone-700">{mes}</td>
                    {CATS.map(c => (
                      <td key={c.key} className="px-2 py-2">
                        <input
                          type="number"
                          min="0"
                          value={e[c.key] ?? 0}
                          onFocus={ev => ev.target.select()}
                          onChange={ev => setEdit(m, c.key, Number(ev.target.value))}
                          className="w-28 border border-stone-200 rounded-lg px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-bold text-violet-700">{fmtMXN(total)}</td>
                    <td className="px-3 py-2">
                      <input
                        value={e.notas || ""}
                        onChange={ev => setEdit(m, "notas", ev.target.value)}
                        placeholder="—"
                        className="w-36 border border-stone-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-stone-50 border-t-2 border-stone-200">
              <tr>
                <td className="px-4 py-3 font-bold text-stone-700">Total</td>
                {CATS.map(c => (
                  <td key={c.key} className="px-3 py-3 text-right font-bold text-stone-700">{fmtMXN(totalCat(c.key))}</td>
                ))}
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