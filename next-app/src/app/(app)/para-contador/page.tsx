"use client";

import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { fmtMXN, paramsToObject, MESES, parseFechaLocal, type ParamMap } from "@/lib/calculos";
import type { Evento, FormaPago, PagoTerapia, Subarrendamiento } from "@/types/db";

const FORMAS_FACTURABLES: FormaPago[] = ["Transferencia", "Tarjeta", "Depósito"];
const esFacturable = (forma: FormaPago | undefined) => !!forma && FORMAS_FACTURABLES.includes(forma);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden mb-6">
      <div className="px-5 py-3 bg-stone-50 border-b border-stone-100">
        <h2 className="text-sm font-bold text-stone-700">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function TH({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2.5 text-xs font-semibold text-stone-500 ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export default function ParaContadorPage() {
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [params, setParams] = useState<ParamMap>({});
  const [pagos, setPagos] = useState<PagoTerapia[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [subarr, setSubarr] = useState<Subarrendamiento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // listAll() pagina internamente; .list(limit) cae al cap de 1000 de
    // Supabase aunque pidas más. CRÍTICO porque esta página alimenta la
    // declaración mensual del contador.
    Promise.all([
      db.parametro.list("clave"),
      db.pago_terapia.listAll("-created_date"),
      db.evento.listAll("-fecha"),
      db.subarrendamiento.listAll(),
    ])
      .then(([p, pg, ev, sub]) => {
        setParams(paramsToObject(p));
        setPagos(pg);
        setEventos(ev);
        setSubarr(sub);
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

  const ivaRate = Number(params.iva ?? 0.16);

  const pagosMes = pagos.filter((p) => p.mes === mes && p.anio === anio);
  const pacientePagosMap: Record<string, { nombre: string; forma_pago: FormaPago; total: number; pagos: PagoTerapia[] }> = {};
  pagosMes.forEach((p) => {
    if (!pacientePagosMap[p.paciente_id]) {
      pacientePagosMap[p.paciente_id] = { nombre: p.paciente_nombre ?? "", forma_pago: p.forma_pago, total: 0, pagos: [] };
    }
    pacientePagosMap[p.paciente_id].total += Number(p.monto_pagado || 0);
    pacientePagosMap[p.paciente_id].pagos.push(p);
    if (p.forma_pago !== "Efectivo") pacientePagosMap[p.paciente_id].forma_pago = p.forma_pago;
  });
  const terapiasRows = Object.values(pacientePagosMap).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const terapiasFacturables = terapiasRows.filter((r) => esFacturable(r.forma_pago));
  const terapiasEfectivo = terapiasRows.filter((r) => !esFacturable(r.forma_pago));

  const subtotalTerapiasFact = terapiasFacturables.reduce((s, r) => s + r.total / (1 + ivaRate), 0);
  const ivaTerapiasFact = terapiasFacturables.reduce((s, r) => s + r.total * ivaRate / (1 + ivaRate), 0);
  const totalTerapiasFact = terapiasFacturables.reduce((s, r) => s + r.total, 0);
  const totalTerapiasEfv = terapiasEfectivo.reduce((s, r) => s + r.total, 0);

  const eventosMes = eventos.filter((ev) => {
    const d = (parseFechaLocal(ev.fecha) ?? new Date(0));
    return d.getMonth() + 1 === mes && d.getFullYear() === anio;
  });
  const eventosFacturables = eventosMes.filter((ev) => esFacturable(ev.forma_pago));
  const eventosEfectivo = eventosMes.filter((ev) => !esFacturable(ev.forma_pago));

  const subtotalEventosFact = eventosFacturables.reduce((s, ev) => s + Number(ev.precio_base || 0), 0);
  const ivaEventosFact = subtotalEventosFact * ivaRate;
  const totalEventosFact = subtotalEventosFact + ivaEventosFact;
  const totalEventosEfv = eventosEfectivo.reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);

  const subarrMes = subarr.filter((s) => s.mes === mes && s.anio === anio);
  const subarrFacturables = subarrMes.filter((s) => esFacturable(s.forma_pago));
  const subarrEfectivo = subarrMes.filter((s) => !esFacturable(s.forma_pago));

  const subtotalSubarrFact = subarrFacturables.reduce((s, r) => s + Number(r.monto_cobrado || 0) / (1 + ivaRate), 0);
  const ivaSubarrFact = subarrFacturables.reduce((s, r) => s + Number(r.monto_cobrado || 0) * ivaRate / (1 + ivaRate), 0);
  const totalSubarrFact = subarrFacturables.reduce((s, r) => s + Number(r.monto_cobrado || 0), 0);
  const totalSubarrEfv = subarrEfectivo.reduce((s, r) => s + Number(r.monto_cobrado || 0), 0);

  const totalFactSubtotal = subtotalTerapiasFact + subtotalEventosFact + subtotalSubarrFact;
  const totalFactIva = ivaTerapiasFact + ivaEventosFact + ivaSubarrFact;
  const totalFactTotal = totalTerapiasFact + totalEventosFact + totalSubarrFact;
  const totalEfv = totalTerapiasEfv + totalEventosEfv + totalSubarrEfv;
  const granTotal = totalFactTotal + totalEfv;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Para el Contador</h1>
          <p className="text-sm text-stone-400 mt-0.5">Resumen mensual para declaración de IVA y emisión de CFDIs</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
        </div>
      </div>

      <Section title="① Resumen Mensual para el SAT">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-100">
              <tr>
                <TH>Concepto</TH>
                <TH right>Subtotal sin IVA</TH>
                <TH right>IVA (16%)</TH>
                <TH right>Total con IVA</TH>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={4} className="px-4 py-2 text-xs font-bold text-amber-700 bg-amber-50 border-t border-amber-100">FACTURABLE (transferencia / tarjeta / depósito)</td></tr>
              <tr className="border-t border-stone-50 hover:bg-amber-50/30">
                <td className="px-4 py-2.5 text-stone-700 pl-8">Terapias</td>
                <td className="px-4 py-2.5 text-right text-stone-600">{fmtMXN(subtotalTerapiasFact)}</td>
                <td className="px-4 py-2.5 text-right text-stone-600">{fmtMXN(ivaTerapiasFact)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-stone-800">{fmtMXN(totalTerapiasFact)}</td>
              </tr>
              <tr className="border-t border-stone-50 hover:bg-amber-50/30">
                <td className="px-4 py-2.5 text-stone-700 pl-8">Citas y Evaluaciones</td>
                <td className="px-4 py-2.5 text-right text-stone-600">{fmtMXN(subtotalEventosFact)}</td>
                <td className="px-4 py-2.5 text-right text-stone-600">{fmtMXN(ivaEventosFact)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-stone-800">{fmtMXN(totalEventosFact)}</td>
              </tr>
              <tr className="border-t border-stone-50 hover:bg-amber-50/30">
                <td className="px-4 py-2.5 text-stone-700 pl-8">Subarrendamiento</td>
                <td className="px-4 py-2.5 text-right text-stone-600">{fmtMXN(subtotalSubarrFact)}</td>
                <td className="px-4 py-2.5 text-right text-stone-600">{fmtMXN(ivaSubarrFact)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-stone-800">{fmtMXN(totalSubarrFact)}</td>
              </tr>
              <tr className="border-t-2 border-amber-200 bg-amber-50">
                <td className="px-4 py-3 font-bold text-amber-800 pl-8">TOTAL FACTURABLE</td>
                <td className="px-4 py-3 text-right font-bold text-amber-800">{fmtMXN(totalFactSubtotal)}</td>
                <td className="px-4 py-3 text-right font-bold text-amber-800">{fmtMXN(totalFactIva)}</td>
                <td className="px-4 py-3 text-right font-bold text-amber-800 text-base">{fmtMXN(totalFactTotal)}</td>
              </tr>

              <tr><td colSpan={4} className="px-4 py-2 text-xs font-bold text-stone-500 bg-stone-50 border-t border-stone-200">EFECTIVO (no se factura — solo para conciliación)</td></tr>
              <tr className="border-t border-stone-50">
                <td className="px-4 py-2.5 text-stone-500 pl-8">Terapias</td>
                <td className="px-4 py-2.5 text-right text-stone-400" colSpan={2}>—</td>
                <td className="px-4 py-2.5 text-right text-stone-500">{fmtMXN(totalTerapiasEfv)}</td>
              </tr>
              <tr className="border-t border-stone-50">
                <td className="px-4 py-2.5 text-stone-500 pl-8">Citas y Evaluaciones</td>
                <td className="px-4 py-2.5 text-right text-stone-400" colSpan={2}>—</td>
                <td className="px-4 py-2.5 text-right text-stone-500">{fmtMXN(totalEventosEfv)}</td>
              </tr>
              <tr className="border-t border-stone-50">
                <td className="px-4 py-2.5 text-stone-500 pl-8">Subarrendamiento</td>
                <td className="px-4 py-2.5 text-right text-stone-400" colSpan={2}>—</td>
                <td className="px-4 py-2.5 text-right text-stone-500">{fmtMXN(totalSubarrEfv)}</td>
              </tr>
              <tr className="border-t border-stone-200 bg-stone-50">
                <td className="px-4 py-2.5 font-semibold text-stone-600 pl-8">Total Efectivo</td>
                <td colSpan={2} />
                <td className="px-4 py-2.5 text-right font-semibold text-stone-600">{fmtMXN(totalEfv)}</td>
              </tr>

              <tr className="border-t-2 border-violet-200 bg-violet-50">
                <td className="px-4 py-3 font-bold text-violet-800 text-base" colSpan={3}>GRAN TOTAL COBRADO EN EL MES</td>
                <td className="px-4 py-3 text-right font-bold text-violet-800 text-base">{fmtMXN(granTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="② Detalle de Terapias a Facturar">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-100">
              <tr>
                <TH>Paciente</TH>
                <TH>Forma de Pago</TH>
                <TH right>Subtotal sin IVA</TH>
                <TH right>IVA (16%)</TH>
                <TH right>Total con IVA</TH>
              </tr>
            </thead>
            <tbody>
              {terapiasRows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-stone-400 text-xs">Sin pagos registrados en este mes</td></tr>
              )}
              {terapiasRows.map((r, i) => {
                const facturable = esFacturable(r.forma_pago);
                const subtotal = r.total / (1 + ivaRate);
                const iva = r.total * ivaRate / (1 + ivaRate);
                return (
                  <tr key={i} className={`border-t border-stone-50 ${!facturable ? "opacity-40" : "hover:bg-amber-50/30"}`}>
                    <td className="px-4 py-2.5 font-medium text-stone-800">{r.nombre}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${facturable ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>{r.forma_pago || "Efectivo"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{facturable ? fmtMXN(subtotal) : "—"}</td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{facturable ? fmtMXN(iva) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-stone-800">{fmtMXN(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            {terapiasFacturables.length > 0 && (
              <tfoot className="bg-amber-50 border-t-2 border-amber-200">
                <tr>
                  <td className="px-4 py-2.5 font-bold text-amber-800" colSpan={2}>Total a facturar</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(subtotalTerapiasFact)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(ivaTerapiasFact)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(totalTerapiasFact)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>

      <Section title="③ Detalle de Citas y Evaluaciones a Facturar">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-100">
              <tr>
                <TH>Solicitante</TH>
                <TH>Tipo</TH>
                <TH>Forma de Pago</TH>
                <TH right>Subtotal</TH>
                <TH right>IVA</TH>
                <TH right>Total</TH>
                <TH>Fecha Pago</TH>
              </tr>
            </thead>
            <tbody>
              {eventosMes.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-stone-400 text-xs">Sin eventos en este mes</td></tr>
              )}
              {eventosMes.map((ev, i) => {
                const facturable = esFacturable(ev.forma_pago);
                const subtotal = Number(ev.precio_base || 0);
                const iva = facturable ? subtotal * ivaRate : 0;
                const total = subtotal + iva;
                return (
                  <tr key={i} className={`border-t border-stone-50 ${!facturable ? "opacity-40" : "hover:bg-amber-50/30"}`}>
                    <td className="px-4 py-2.5 font-medium text-stone-800">{ev.nombre_paciente}</td>
                    <td className="px-4 py-2.5 text-stone-600 text-xs">{ev.tipo}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${facturable ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>{ev.forma_pago}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{facturable ? fmtMXN(subtotal) : "—"}</td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{facturable ? fmtMXN(iva) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-stone-800">{fmtMXN(total)}</td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs">{ev.fecha_pago || ev.fecha}</td>
                  </tr>
                );
              })}
            </tbody>
            {eventosFacturables.length > 0 && (
              <tfoot className="bg-amber-50 border-t-2 border-amber-200">
                <tr>
                  <td className="px-4 py-2.5 font-bold text-amber-800" colSpan={3}>Total a facturar</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(subtotalEventosFact)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(ivaEventosFact)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(totalEventosFact)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>

      <Section title="④ Detalle de Subarrendamiento a Facturar">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-100">
              <tr>
                <TH>Inquilino</TH>
                <TH>Forma de Pago</TH>
                <TH right>Subtotal sin IVA</TH>
                <TH right>IVA (16%)</TH>
                <TH right>Total con IVA</TH>
              </tr>
            </thead>
            <tbody>
              {subarrMes.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-stone-400 text-xs">Sin registros de subarrendamiento en este mes</td></tr>
              )}
              {subarrMes.map((r, i) => {
                const facturable = esFacturable(r.forma_pago);
                const monto = Number(r.monto_cobrado || 0);
                const subtotal = monto / (1 + ivaRate);
                const iva = monto * ivaRate / (1 + ivaRate);
                return (
                  <tr key={i} className={`border-t border-stone-50 ${!facturable ? "opacity-40" : "hover:bg-amber-50/30"}`}>
                    <td className="px-4 py-2.5 font-medium text-stone-800">{r.inquilino}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${facturable ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>{r.forma_pago}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{facturable ? fmtMXN(subtotal) : "—"}</td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{facturable ? fmtMXN(iva) : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-stone-800">{fmtMXN(monto)}</td>
                  </tr>
                );
              })}
            </tbody>
            {subarrFacturables.length > 0 && (
              <tfoot className="bg-amber-50 border-t-2 border-amber-200">
                <tr>
                  <td className="px-4 py-2.5 font-bold text-amber-800" colSpan={2}>Total a facturar</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(subtotalSubarrFact)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(ivaSubarrFact)}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-amber-800">{fmtMXN(totalSubarrFact)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Section>
    </div>
  );
}
