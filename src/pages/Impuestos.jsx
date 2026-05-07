import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { fmtMXN, calcularISR, paramsToObject, MESES } from "@/lib/calculos";

export default function Impuestos() {
  const [params, setParams] = useState({});
  const [pagos, setPagos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [nomina, setNomina] = useState([]);
  const [subarr, setSubarr] = useState([]);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState({});

  useEffect(() => {
    Promise.all([
      base44.entities.Parametro.list(),
      base44.entities.PagoTerapia.list(),
      base44.entities.Evento.list(),
      base44.entities.Gasto.list(),
      base44.entities.NominaMensual.list(),
      base44.entities.Subarrendamiento.list(),
    ]).then(([p, pg, ev, g, n, s]) => {
      setParams(paramsToObject(p));
      setPagos(pg);
      setEventos(ev);
      setGastos(g);
      setNomina(n);
      setSubarr(s);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>;

  const ivaRate = Number(params.iva || 0.16);
  const imssRate = Number(params.imss_patronal || 0.30);
  const isnRate = Number(params.isn_nl || 0.03);
  const factorBrutoNeto = Number(params.factor_bruto_neto || 1.10);

  const mesData = MESES.map((_, i) => {
    const mes = i + 1;

    // IVA trasladado (ingresos con transferencia)
    const pagosMes = pagos.filter(p => p.mes === mes);
    const ivaTrasTerapias = pagosMes.filter(p => p.forma_pago !== "Efectivo")
      .reduce((sum, p) => sum + Number(p.monto_pagado || 0) * ivaRate / (1 + ivaRate), 0);

    const eventosMes = eventos.filter(ev => new Date(ev.fecha).getMonth() + 1 === mes);
    const ivaTrasEventos = eventosMes.filter(ev => ev.forma_pago !== "Efectivo")
      .reduce((sum, ev) => {
        const precio = Number(ev.precio_base || 0);
        return sum + precio * ivaRate;
      }, 0);

    const subarrMes = subarr.filter(s => s.mes === mes);
    const ivaSubarr = subarrMes.filter(s => s.forma_pago !== "Efectivo")
      .reduce((sum, s) => sum + Number(s.monto_cobrado || 0) * ivaRate / (1 + ivaRate), 0);

    const ivaTrasladadoTotal = ivaTrasTerapias + ivaTrasEventos + ivaSubarr;

    // IVA acreditable (gastos con factura)
    const gastosMes = gastos.filter(g => new Date(g.fecha).getMonth() + 1 === mes);
    const ivaAcreditable = gastosMes.filter(g => g.con_factura)
      .reduce((sum, g) => sum + Number(g.monto || 0) * ivaRate, 0);

    const ivaPagar = Math.max(0, ivaTrasladadoTotal - ivaAcreditable);
    const saldoFavor = Math.max(0, ivaAcreditable - ivaTrasladadoTotal);

    // Ingresos acumulables ISR (solo transferencia, tarjeta, depósito — NO efectivo)
    const ingresosTransf = pagosMes.filter(p => p.forma_pago !== "Efectivo")
      .reduce((sum, p) => sum + Number(p.monto_pagado || 0) / (1 + ivaRate), 0);
    const ingresosEventosTransf = eventosMes.filter(ev => ev.forma_pago !== "Efectivo")
      .reduce((sum, ev) => sum + Number(ev.monto_pagado || 0) / (1 + ivaRate), 0);
    const ingresosSubarr = subarrMes.filter(s => s.forma_pago !== "Efectivo")
      .reduce((sum, s) => sum + Number(s.monto_cobrado || 0) / (1 + ivaRate), 0);
    const ingresosTotales = ingresosTransf + ingresosEventosTransf + ingresosSubarr;

    // Deducciones ISR
    const nominaMes = nomina.filter(n => n.mes === mes);
    const sueldosTransf = nominaMes.reduce((sum, n) => sum + Number(n.sueldo_transferencia || 0), 0);
    const aguinaldoTransf = nominaMes.reduce((sum, n) => sum + Number(n.aguinaldo || 0) * (Number(n.sueldo_transferencia || 0) / (Number(n.sueldo_transferencia || 0) + Number(n.sueldo_efectivo || 0) || 1)), 0);
    const vacTransf = nominaMes.reduce((sum, n) => sum + Number(n.vacaciones || 0) * (Number(n.sueldo_transferencia || 0) / (Number(n.sueldo_transferencia || 0) + Number(n.sueldo_efectivo || 0) || 1)), 0);
    const sueldosTransfBruto = sueldosTransf * factorBrutoNeto;
    const imss = sueldosTransfBruto * imssRate;
    const isn = sueldosTransfBruto * isnRate;
    const gastosDeducibles = gastosMes.filter(g => g.con_factura).reduce((sum, g) => sum + Number(g.monto || 0), 0);
    const deducibleNomina = (sueldosTransf + aguinaldoTransf + vacTransf) * factorBrutoNeto;
    const totalDeducciones = deducibleNomina + imss + isn + gastosDeducibles;

    const utilidadFiscal = Math.max(0, ingresosTotales - totalDeducciones);
    const isrCalculado = calcularISR(utilidadFiscal);
    
    // Usar override si existe, sino calcular
    const ivaPagarFinal = overrides[mes]?.ivaPagar !== undefined ? overrides[mes].ivaPagar : ivaPagar;
    const isrFinal = overrides[mes]?.isr !== undefined ? overrides[mes].isr : isrCalculado;

    return { mes, ivaTrasladadoTotal, ivaAcreditable, ivaPagar: ivaPagarFinal, saldoFavor, ingresosTotales, totalDeducciones, utilidadFiscal, isr: isrFinal };
  });

  const totales = mesData.reduce((acc, m) => ({
    ivaTrasladadoTotal: acc.ivaTrasladadoTotal + m.ivaTrasladadoTotal,
    ivaAcreditable: acc.ivaAcreditable + m.ivaAcreditable,
    ivaPagar: acc.ivaPagar + m.ivaPagar,
    ingresosTotales: acc.ingresosTotales + m.ingresosTotales,
    totalDeducciones: acc.totalDeducciones + m.totalDeducciones,
    utilidadFiscal: acc.utilidadFiscal + m.utilidadFiscal,
    isr: acc.isr + m.isr,
  }), { ivaTrasladadoTotal:0, ivaAcreditable:0, ivaPagar:0, ingresosTotales:0, totalDeducciones:0, utilidadFiscal:0, isr:0 });

  return (
    <div className="p-6 max-w-full">
      <h1 className="text-2xl font-bold text-stone-800 mb-2">Impuestos</h1>
      <p className="text-sm text-stone-400 mb-6">Edita los valores de IVA e ISR con los montos reales pagados según el contador. Los campos calculados se usan si no hay cambios.</p>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Mes</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IVA Trasladado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IVA Acreditable</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500 bg-red-50">IVA a Pagar</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Ingresos ISR</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Deducciones</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Utilidad Fiscal</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500 bg-red-50">ISR Provisional</th>
              </tr>
            </thead>
            <tbody>
              {mesData.map(row => (
                <tr key={row.mes} className="border-t border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3 font-medium text-stone-700">{MESES[row.mes-1]}</td>
                  <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(row.ivaTrasladadoTotal)}</td>
                  <td className="px-4 py-3 text-right text-green-600">{fmtMXN(row.ivaAcreditable)}</td>
                  <td className="px-4 py-3 text-right bg-red-50/50">
                    <input
                      type="number"
                      value={row.ivaPagar}
                      onChange={(e) => setOverrides(prev => ({...prev, [row.mes]: {...(prev[row.mes] || {}), ivaPagar: Number(e.target.value)}}))}
                      className="w-24 border border-stone-200 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(row.ingresosTotales)}</td>
                  <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(row.totalDeducciones)}</td>
                  <td className="px-4 py-3 text-right text-stone-700">{fmtMXN(row.utilidadFiscal)}</td>
                  <td className="px-4 py-3 text-right bg-red-50/50">
                    <input
                      type="number"
                      value={row.isr}
                      onChange={(e) => setOverrides(prev => ({...prev, [row.mes]: {...(prev[row.mes] || {}), isr: Number(e.target.value)}}))}
                      className="w-24 border border-stone-200 rounded-lg px-2 py-1 text-right text-sm font-bold text-red-700 focus:outline-none focus:ring-2 focus:ring-red-200"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-stone-50 border-t-2 border-stone-200">
              <tr>
                <td className="px-4 py-3 font-bold text-stone-700">TOTAL AÑO</td>
                <td className="px-4 py-3 text-right font-bold">{fmtMXN(totales.ivaTrasladadoTotal)}</td>
                <td className="px-4 py-3 text-right font-bold text-green-600">{fmtMXN(totales.ivaAcreditable)}</td>
                <td className="px-4 py-3 text-right font-bold text-red-600 bg-red-50/50">{fmtMXN(totales.ivaPagar)}</td>
                <td className="px-4 py-3 text-right font-bold">{fmtMXN(totales.ingresosTotales)}</td>
                <td className="px-4 py-3 text-right font-bold">{fmtMXN(totales.totalDeducciones)}</td>
                <td className="px-4 py-3 text-right font-bold">{fmtMXN(totales.utilidadFiscal)}</td>
                <td className="px-4 py-3 text-right font-bold text-red-700 bg-red-50/50">{fmtMXN(totales.isr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}