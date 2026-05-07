import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { fmtMXN, MESES, diasVacacionesLFT, paramsToObject } from "@/lib/calculos";

function calcAnios(fechaIngreso) {
  if (!fechaIngreso) return 0;
  return Math.floor((new Date() - new Date(fechaIngreso)) / (365.25 * 24 * 3600 * 1000));
}

export default function Nomina() {
  const [empleados, setEmpleados] = useState([]);
  const [nomina, setNomina] = useState([]);
  const [params, setParams] = useState({});
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState({});
  const timeoutRef = useRef(null);

  const load = async () => {
    const [emp, nom, par] = await Promise.all([
      base44.entities.Empleado.filter({ estatus: "Activo" }),
      base44.entities.NominaMensual.filter({ mes, anio }),
      base44.entities.Parametro.list(),
    ]);
    setEmpleados(emp);
    setParams(paramsToObject(par));

    // Si no hay nómina para este mes/año, crear automáticamente desde el catálogo
    let nomData = nom;
    if (nom.length === 0) {
      const opsCrear = emp.map(e => {
        const st = Number(e.sueldo_transferencia_mes || 0);
        const se = Number(e.sueldo_efectivo_mes || 0);
        const sueldoTotal = st + se;
        const anios = Math.floor((new Date() - new Date(e.fecha_ingreso)) / (365.25 * 24 * 3600 * 1000));
        const diasVac = anios >= 20 ? 20 : anios >= 15 ? 18 : anios >= 10 ? 16 : anios >= 6 ? 14 : anios >= 4 ? 12 : 6;
        const aguinaldo = anio === 2026 && mes === 12 ? sueldoTotal / 30 * 15 : 0;
        const vacaciones = sueldoTotal / 30 * diasVac * 1.25 / 12;
        return base44.entities.NominaMensual.create({
          empleado_id: e.id,
          empleado_nombre: e.nombre,
          anio,
          mes,
          sueldo_transferencia: st,
          sueldo_efectivo: se,
          aguinaldo,
          vacaciones,
          bono: 0,
        });
      });
      await Promise.all(opsCrear);
      nomData = await base44.entities.NominaMensual.filter({ mes, anio });
    }

    setNomina(nomData);
    // Inicializar overrides desde nómina guardada
    const ov = {};
    nomData.forEach(n => {
      ov[n.empleado_id] = {
        sueldo_transferencia: n.sueldo_transferencia,
        sueldo_efectivo: n.sueldo_efectivo,
        bono: n.bono || 0,
      };
    });
    setOverrides(ov);
    setLoading(false);
  };

  useEffect(() => { load(); }, [mes, anio]);

  const getVal = (emp, key) => {
    if (overrides[emp.id]?.[key] !== undefined) return overrides[emp.id][key];
    return Number(emp[`${key}_mes`] || 0);
  };

  const setVal = (empId, key, val) => {
    setOverrides(prev => ({ ...prev, [empId]: { ...prev[empId], [key]: Number(val) } }));
    // Autoguardado con debounce 500ms
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      autoguardar(empId, key, Number(val));
    }, 500);
  };

  const autoguardar = async (empId, key, val) => {
    const emp = empleados.find(e => e.id === empId);
    if (!emp) return;
    const st = getVal(emp, "sueldo_transferencia");
    const se = getVal(emp, "sueldo_efectivo");
    const sueldoTotal = st + se;
    const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
    let vacaciones = 0;
    if (emp.fecha_ingreso) {
      const fechaIngreso = new Date(emp.fecha_ingreso);
      const mesAniversario = fechaIngreso.getMonth() + 1;
      if (mes === mesAniversario) {
        const anios = calcAnios(emp.fecha_ingreso);
        if (anios >= 1) {
          const diasVac = diasVacacionesLFT(anios);
          vacaciones = Math.round(sueldoTotal / 30 * diasVac * 0.25);
        }
      }
    }
    const bono = overrides[empId]?.bono ?? 0;
    const existente = nomina.find(n => n.empleado_id === empId);
    const data = {
      empleado_id: empId,
      empleado_nombre: emp.nombre,
      anio,
      mes,
      sueldo_transferencia: st,
      sueldo_efectivo: se,
      aguinaldo,
      vacaciones,
      bono,
    };
    try {
      if (existente) {
        await base44.entities.NominaMensual.update(existente.id, data);
      } else {
        await base44.entities.NominaMensual.create(data);
      }
    } catch (e) {
      console.error("Error en autoguardado:", e);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    for (const emp of empleados) {
      const st = getVal(emp, "sueldo_transferencia");
      const se = getVal(emp, "sueldo_efectivo");
      const sueldoTotal = st + se;
      const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
      // Prima vacacional: SOLO en mes aniversario (LFT)
      let vacaciones = 0;
      if (emp.fecha_ingreso) {
        const fechaIngreso = new Date(emp.fecha_ingreso);
        const mesAniversario = fechaIngreso.getMonth() + 1;
        if (mes === mesAniversario) {
          const anios = calcAnios(emp.fecha_ingreso);
          if (anios >= 1) {
            const diasVac = diasVacacionesLFT(anios);
            vacaciones = Math.round(sueldoTotal / 30 * diasVac * 0.25);
          }
          }
          }

          const bono = overrides[emp.id]?.bono ?? 0;
      const existente = nomina.find(n => n.empleado_id === emp.id);
      const data = {
        empleado_id: emp.id, empleado_nombre: emp.nombre,
        anio, mes, sueldo_transferencia: st, sueldo_efectivo: se,
        aguinaldo, vacaciones, bono
      };
      if (existente) await base44.entities.NominaMensual.update(existente.id, data);
      else await base44.entities.NominaMensual.create(data);
    }
    setSaving(false);
    load();
  };

  const imssRate = Number(params.imss_patronal || 0.30);
  const isnRate = Number(params.isn_nl || 0.03);
  const isrRetenidoRate = Number(params.isr_retenido_empleados || 0.06);
  const factorBrutoNeto = Number(params.factor_bruto_neto || 1.10);

  const rows = empleados.map(emp => {
    const st = getVal(emp, "sueldo_transferencia");
    const se = getVal(emp, "sueldo_efectivo");
    const sueldoTotal = st + se;
    const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
    // Prima vacacional: SOLO en mes aniversario (LFT)
    let vacaciones = 0, diasVac = 0;
    if (emp.fecha_ingreso) {
      const fechaIngreso = new Date(emp.fecha_ingreso);
      const mesAniversario = fechaIngreso.getMonth() + 1;
      if (mes === mesAniversario) {
        const anios = calcAnios(emp.fecha_ingreso);
        if (anios >= 1) {
          diasVac = diasVacacionesLFT(anios);
          vacaciones = Math.round(sueldoTotal / 30 * diasVac * 1.25);
        }
      }
    }
    const bono = overrides[emp.id]?.bono ?? 0;
    const stBruto = st * factorBrutoNeto;
    const imss = stBruto * imssRate;
    const isn = stBruto * isnRate;
    const isrRetenido = stBruto * isrRetenidoRate;
    const totalEgreso = st + se + aguinaldo + vacaciones + bono + imss + isn;
    return { emp, st, se, sueldoTotal, aguinaldo, vacaciones, bono, imss, isn, isrRetenido, totalEgreso, diasVac };
  });

  const totales = rows.reduce((acc, r) => ({
    st: acc.st + r.st, se: acc.se + r.se, sueldoTotal: acc.sueldoTotal + r.sueldoTotal,
    aguinaldo: acc.aguinaldo + r.aguinaldo, vacaciones: acc.vacaciones + r.vacaciones,
    bono: acc.bono + r.bono,
    imss: acc.imss + r.imss, isn: acc.isn + r.isn, isrRetenido: acc.isrRetenido + r.isrRetenido,
    totalEgreso: acc.totalEgreso + r.totalEgreso,
  }), { st:0, se:0, sueldoTotal:0, aguinaldo:0, vacaciones:0, bono:0, imss:0, isn:0, isrRetenido:0, totalEgreso:0 });

  return (
    <div className="p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Nómina</h1>
        <div className="flex items-center gap-2">
          <select value={mes} onChange={e => setMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MESES.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))}
            className="w-20 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          <button onClick={saveAll} disabled={saving}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar Nómina"}
          </button>
        </div>
      </div>

      <div className="mb-3 text-xs text-stone-400 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2 space-y-0.5">
        <p>Los valores de sueldo están prellenados desde el catálogo de empleados. Puedes modificarlos aquí si hay variación en el mes.</p>
        <p>Impuestos (IMSS {(imssRate*100).toFixed(0)}%, ISN {(isnRate*100).toFixed(0)}%, ISR ret. {(isrRetenidoRate*100).toFixed(0)}%) se calculan sobre Sueldo Transf. × Factor Bruto/Neto ({factorBrutoNeto.toFixed(2)}) — solo la parte <strong>fiscal</strong>.</p>
        <p>Aguinaldo y prima vacacional se calculan sobre sueldo total (transferencia + efectivo). <strong>Bono</strong>: pago en efectivo, no fiscal, no entra en base de impuestos.</p>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Empleado</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Sueldo Transf.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Sueldo Efvo.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total Sueldo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Aguinaldo</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Bono Objetivos <span className="text-stone-300 font-normal">(efvo.)</span></th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Vac+Prima/mes</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IMSS Pat.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">ISN</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">ISR Ret.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total Egreso</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : rows.map(({ emp, st, se, sueldoTotal, aguinaldo, vacaciones, bono, imss, isn, isrRetenido, totalEgreso }) => (
                <tr key={emp.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-800">{emp.nombre}</p>
                    <p className="text-xs text-stone-400">{emp.puesto}</p>
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" min="0" value={st}
                      onChange={e => setVal(emp.id, "sueldo_transferencia", e.target.value)}
                      className="w-28 border border-stone-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-violet-200" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" min="0" value={se}
                      onChange={e => setVal(emp.id, "sueldo_efectivo", e.target.value)}
                      className="w-28 border border-stone-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-violet-200" />
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-stone-700">{fmtMXN(sueldoTotal)}</td>
                  <td className="px-4 py-3 text-right text-stone-600">{mes === 12 ? fmtMXN(aguinaldo) : "—"}</td>
                  <td className="px-4 py-2">
                    <input type="number" min="0" value={overrides[emp.id]?.bono ?? 0}
                      onChange={e => setVal(emp.id, "bono", e.target.value)}
                      className="w-28 border border-stone-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-violet-200" />
                  </td>
                  <td className="px-4 py-3 text-right text-stone-600">{fmtMXN(vacaciones)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{fmtMXN(imss)}</td>
                  <td className="px-4 py-3 text-right text-amber-600">{fmtMXN(isn)}</td>
                  <td className="px-4 py-3 text-right text-stone-500">{fmtMXN(isrRetenido)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-800">{fmtMXN(totalEgreso)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-stone-50 border-t-2 border-stone-200">
                <tr>
                  <td className="px-4 py-3 font-bold text-stone-700">TOTALES</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.st)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.se)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.sueldoTotal)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{mes === 12 ? fmtMXN(totales.aguinaldo) : "—"}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.bono)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.vacaciones)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{fmtMXN(totales.imss)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{fmtMXN(totales.isn)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-500">{fmtMXN(totales.isrRetenido)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-800">{fmtMXN(totales.totalEgreso)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}