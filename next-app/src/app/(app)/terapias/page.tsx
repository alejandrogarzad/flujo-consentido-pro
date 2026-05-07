"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { calcularTotalTerapia, paramsToObject, fmtMXN, MESES, pacienteAplicaEnMes, type ParamMap } from "@/lib/calculos";
import type { Paciente, PagoTerapia, SesionMensual } from "@/types/db";

export default function TerapiasPage() {
  const [params, setParams] = useState<ParamMap>({});
  const [sesiones, setSesiones] = useState<SesionMensual[]>([]);
  const [pagos, setPagos] = useState<PagoTerapia[]>([]);
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [filtroMes, setFiltroMes] = useState(new Date().getMonth() + 1);
  const [filtroAnio, setFiltroAnio] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      db.parametro.list("clave"),
      db.sesion_mensual.list("-created_date", 2000),
      db.pago_terapia.list("-created_date", 2000),
      db.paciente.list("nombre", 500),
    ])
      .then(([p, s, pg, pac]) => {
        setParams(paramsToObject(p));
        setSesiones(s);
        setPagos(pg);
        setPacientes(pac);
      })
      .catch((err: any) => toast.error(err?.message || "Error al cargar"))
      .finally(() => setLoading(false));
  }, []);

  const pacientesById = Object.fromEntries(pacientes.map((p) => [p.id, p]));
  const sesionesMes = sesiones.filter((s) => {
    if (s.mes !== filtroMes || s.anio !== filtroAnio) return false;
    const pac = pacientesById[s.paciente_id];
    return pac && pacienteAplicaEnMes(pac, filtroMes, filtroAnio);
  });

  const rows = sesionesMes.map((s) => {
    const pagosMes = pagos.filter((p) => p.paciente_id === s.paciente_id && p.mes === s.mes && p.anio === s.anio);
    const totalPagado = pagosMes.reduce((sum, p) => sum + Number(p.monto_pagado || 0), 0);
    const ultimoPago = pagosMes.slice().sort((a, b) => new Date(b.fecha_pago).getTime() - new Date(a.fecha_pago).getTime())[0];
    const calculo = calcularTotalTerapia(
      s,
      {
        forma_pago: s.forma_pago_mes,
        dia_pago: ultimoPago?.dia_pago ?? undefined,
        fecha_pago: ultimoPago?.fecha_pago,
        monto_pagado: totalPagado,
      },
      params,
      pacientesById[s.paciente_id],
    );
    return { s, calculo, totalPagado };
  });

  const totales = rows.reduce(
    (acc, r) => ({
      subtotal: acc.subtotal + r.calculo.subtotal,
      beca: acc.beca + r.calculo.becaAplicada,
      neto: acc.neto + r.calculo.neto,
      recargo: acc.recargo + r.calculo.recargo,
      iva: acc.iva + r.calculo.iva,
      total: acc.total + r.calculo.totalEsperado,
      pagado: acc.pagado + r.totalPagado,
      saldo: acc.saldo + r.calculo.saldo,
    }),
    { subtotal: 0, beca: 0, neto: 0, recargo: 0, iva: 0, total: 0, pagado: 0, saldo: 0 },
  );

  return (
    <div className="p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Vista de Terapias</h1>
        <div className="flex items-center gap-2">
          <select value={filtroMes} onChange={(e) => setFiltroMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={filtroAnio} onChange={(e) => setFiltroAnio(Number(e.target.value))}
            className="w-24 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Paciente</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Mat</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Reg</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Beca %</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Forma Pago</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Subtotal</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Beca</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Recargo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IVA</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total Esp.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Pagado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-stone-400">Sin datos para {MESES[filtroMes - 1]} {filtroAnio}</td></tr>
              ) : (
                rows.map(({ s, calculo, totalPagado }, i) => (
                  <tr key={i} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3 font-medium text-stone-800">{s.paciente_nombre}</td>
                    <td className="px-4 py-3 text-center text-stone-600">{s.sesiones_matutinas}</td>
                    <td className="px-4 py-3 text-center text-stone-600">{s.sesiones_regulares}</td>
                    <td className="px-4 py-3 text-center text-stone-600">{s.beca_porcentaje}%</td>
                    <td className="px-4 py-3 text-stone-600">{s.forma_pago_mes}</td>
                    <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(calculo.subtotal)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{calculo.becaAplicada > 0 ? `-${fmtMXN(calculo.becaAplicada)}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-red-500">{calculo.recargo > 0 ? `+${fmtMXN(calculo.recargo)}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-500">{calculo.iva > 0 ? fmtMXN(calculo.iva) : "—"}</td>
                    <td className="px-4 py-3 text-right font-medium text-stone-800">{fmtMXN(calculo.totalEsperado)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{fmtMXN(totalPagado)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${calculo.saldo > 0 ? "text-red-600" : "text-green-600"}`}>
                      {fmtMXN(calculo.saldo)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-stone-50 border-t-2 border-stone-200">
                <tr>
                  <td className="px-4 py-3 font-bold text-stone-700" colSpan={5}>TOTALES</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.subtotal)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">-{fmtMXN(totales.beca)}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-500">{fmtMXN(totales.recargo)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-500">{fmtMXN(totales.iva)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-800">{fmtMXN(totales.total)}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-600">{fmtMXN(totales.pagado)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${totales.saldo > 0 ? "text-red-600" : "text-green-600"}`}>{fmtMXN(totales.saldo)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
