import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { calcularTotalTerapia, paramsToObject, fmtMXN, estatusCxC, MESES, pacienteAplicaEnMes } from "@/lib/calculos";

export default function CXC() {
  const [params, setParams] = useState({});
  const [sesiones, setSesiones] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [pacientes, setPacientes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Parametro.list(),
      base44.entities.SesionMensual.list("-created_date", 2000),
      base44.entities.PagoTerapia.list("-created_date", 2000),
      base44.entities.Paciente.filter({ estatus: "Activo" }, "nombre", 200),
    ]).then(([p, s, pg, pac]) => {
      setParams(paramsToObject(p));
      setSesiones(s);
      setPagos(pg);
      setPacientes(pac);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>;

  const colorMap = { green: "bg-green-100 text-green-700", yellow: "bg-yellow-100 text-yellow-700", orange: "bg-orange-100 text-orange-700", red: "bg-red-100 text-red-700" };

  const rows = pacientes.map(pac => {
   const mesData = MESES.map((_, i) => {
     const mes = i + 1;
     const anio = 2026; // Ajustar si es necesario para otros años
     // Aplicar regla unificada de fechas
     if (!pacienteAplicaEnMes(pac, mes, anio)) return null;
     const pagosMes = pagos.filter(p => p.paciente_id === pac.id && p.mes === mes);
     if (pagosMes.length === 0) return null;
     const totalPagado = pagosMes.reduce((sum, p) => sum + Number(p.monto_pagado || 0), 0);
     // Si pagó algo, saldo = 0. Si está en $0, significa que está registrado pero sin monto.
     return totalPagado > 0 ? 0 : null;
   });
   const totalSaldo = mesData.reduce((sum, s) => sum + (s || 0), 0);
   const estatus = estatusCxC(totalSaldo);
   return { pac, mesData, totalSaldo, estatus };
  }).filter(r => r.mesData.some(s => s !== null));

  const totalCxC = rows.reduce((sum, r) => sum + r.totalSaldo, 0);

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Cuentas por Cobrar</h1>
        <div className="text-sm font-semibold text-stone-600">
          CxC Total: <span className={totalCxC > 0 ? "text-red-600" : "text-green-600"}>{fmtMXN(totalCxC)}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500 sticky left-0 bg-stone-50">Paciente</th>
                {MESES.map(m => (
                  <th key={m} className="px-2 py-3 text-right text-xs font-semibold text-stone-500">{m.substring(0,3)}</th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-stone-500">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pac, mesData, totalSaldo, estatus }) => (
                <tr key={pac.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3 font-medium text-stone-800 sticky left-0 bg-white">{pac.nombre}</td>
                  {mesData.map((saldo, i) => (
                    <td key={i} className={`px-2 py-3 text-right text-xs ${saldo === null ? "text-stone-200" : saldo > 0 ? "text-red-600 font-medium" : "text-green-600"}`}>
                      {saldo === null ? "—" : fmtMXN(saldo)}
                    </td>
                  ))}
                  <td className={`px-4 py-3 text-right font-bold ${totalSaldo > 0 ? "text-red-600" : "text-green-600"}`}>{fmtMXN(totalSaldo)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[estatus.color]}`}>{estatus.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}