"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, DollarSign, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { fmtMXN, paramsToObject, MESES, type ParamMap } from "@/lib/calculos";
import type { Evento, Gasto, NominaMensual, PagoTerapia, SesionMensual, Subarrendamiento } from "@/types/db";

export default function DashboardPage() {
  const [params, setParams] = useState<ParamMap>({});
  const [, setSesiones] = useState<SesionMensual[]>([]);
  const [pagos, setPagos] = useState<PagoTerapia[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [subarr, setSubarr] = useState<Subarrendamiento[]>([]);
  const [nomina, setNomina] = useState<NominaMensual[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      db.parametro.list("clave"),
      db.sesion_mensual.list(),
      db.pago_terapia.list(),
      db.evento.list(),
      db.gasto.list(),
      db.subarrendamiento.list(),
      db.nomina_mensual.list(),
    ])
      .then(([p, s, pg, ev, g, su, n]) => {
        setParams(paramsToObject(p));
        setSesiones(s);
        setPagos(pg);
        setEventos(ev);
        setGastos(g);
        setSubarr(su);
        setNomina(n);
      })
      .catch((err: any) => toast.error(err?.message || "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  const anioContable = Number(params.anio_actual ?? new Date().getFullYear());

  const ingresosPorMes = Array(12).fill(0);
  pagos.forEach((p) => {
    if ((!p.anio || p.anio === anioContable) && p.mes) {
      ingresosPorMes[p.mes - 1] += Number(p.monto_pagado || 0);
    }
  });
  eventos.forEach((ev) => {
    if (ev.monto_pagado) {
      const d = new Date(ev.fecha);
      if (d.getFullYear() === anioContable) ingresosPorMes[d.getMonth()] += Number(ev.monto_pagado);
    }
  });
  subarr.forEach((s) => {
    if ((!s.anio || s.anio === anioContable) && s.mes) {
      ingresosPorMes[s.mes - 1] += Number(s.monto_cobrado || 0);
    }
  });

  const egresosPorMes = Array(12).fill(0);
  const imssRate = Number(params.imss_patronal ?? 0.30);
  const isnRate = Number(params.isn_nl ?? 0.03);

  gastos.forEach((g) => {
    const d = new Date(g.fecha);
    if (d.getFullYear() === anioContable) egresosPorMes[d.getMonth()] += Number(g.monto || 0);
  });
  nomina.forEach((n) => {
    if (n.anio && n.anio !== anioContable) return;
    const idx = (n.mes || 1) - 1;
    if (idx >= 0 && idx < 12) {
      const st = Number(n.sueldo_transferencia || 0);
      const se = Number(n.sueldo_efectivo || 0);
      const aguinaldo = Number(n.aguinaldo || 0);
      const vacaciones = Number(n.vacaciones || 0);
      const imss = st * imssRate;
      const isn = st * isnRate;
      egresosPorMes[idx] += st + se + aguinaldo + vacaciones + imss + isn;
    }
  });

  const mesActual = new Date().getMonth();
  const totalIngresos = ingresosPorMes.slice(0, mesActual + 1).reduce((a, b) => a + b, 0);
  const totalEgresos = egresosPorMes.slice(0, mesActual + 1).reduce((a, b) => a + b, 0);
  const flujoNeto = totalIngresos - totalEgresos;

  const saldoInicial = Number(params.saldo_inicial_caja ?? 100000);
  let saldoAcum = saldoInicial;
  const chartData = MESES.map((mes, i) => {
    const esFuturo = i > mesActual;
    const neto = ingresosPorMes[i] - egresosPorMes[i];
    if (!esFuturo) saldoAcum += neto;
    return {
      mes: mes.substring(0, 3),
      ingresos: esFuturo ? null : Math.round(ingresosPorMes[i]),
      egresos: esFuturo ? null : Math.round(egresosPorMes[i]),
      saldo: esFuturo ? null : Math.round(saldoAcum),
    };
  });

  const saldoFinal = chartData[mesActual]?.saldo ?? 0;

  const kpis = [
    { label: `Ingresos Cobrados (Ene–${MESES[mesActual].substring(0, 3)})`, value: fmtMXN(totalIngresos), icon: TrendingUp, color: "text-green-600", bg: "bg-green-50" },
    { label: `Egresos (Ene–${MESES[mesActual].substring(0, 3)})`, value: fmtMXN(totalEgresos), icon: TrendingDown, color: "text-red-500", bg: "bg-red-50" },
    { label: "Flujo Neto YTD", value: fmtMXN(flujoNeto), icon: DollarSign, color: flujoNeto >= 0 ? "text-green-600" : "text-red-500", bg: flujoNeto >= 0 ? "bg-green-50" : "bg-red-50" },
    { label: "Saldo Actual de Caja", value: fmtMXN(saldoFinal), icon: Wallet, color: saldoFinal >= 0 ? "text-violet-600" : "text-red-500", bg: "bg-violet-50" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-stone-800 mb-6">Dashboard Ejecutivo {anioContable}</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-xs text-stone-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-600 mb-4">Ingresos vs Egresos por Mes</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtMXN(v)} />
              <Legend />
              <Bar dataKey="ingresos" name="Ingresos" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              <Bar dataKey="egresos" name="Egresos" fill="#f87171" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-stone-600 mb-4">Evolución del Saldo</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtMXN(v)} />
              <Line dataKey="saldo" name="Saldo" stroke="#7c3aed" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-600">Resumen Mensual</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Mes</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Ingresos</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Egresos</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Neto</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((row, i) => {
                const esFuturo = i > mesActual;
                return (
                  <tr key={i} className={`border-t border-stone-50 ${esFuturo ? "opacity-30" : "hover:bg-stone-50/50"}`}>
                    <td className="px-4 py-3 font-medium text-stone-700">
                      {MESES[i]}
                      {esFuturo && <span className="ml-2 text-xs text-stone-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-green-600">{esFuturo ? "—" : fmtMXN(row.ingresos ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-red-500">{esFuturo ? "—" : fmtMXN(row.egresos ?? 0)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${!esFuturo && (row.ingresos ?? 0) - (row.egresos ?? 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {esFuturo ? "—" : fmtMXN((row.ingresos ?? 0) - (row.egresos ?? 0))}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${!esFuturo && (row.saldo ?? 0) >= 0 ? "text-violet-600" : "text-red-600"}`}>
                      {esFuturo ? "—" : fmtMXN(row.saldo ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
