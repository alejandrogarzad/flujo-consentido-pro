"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { fmtMXN, MESES, diasVacacionesLFT, paramsToObject, calcularNominaDesdeNeto, type ParamMap } from "@/lib/calculos";
import type { Empleado, NominaMensual } from "@/types/db";
import { RefreshCw } from "lucide-react";

function calcAnios(fechaIngreso: string | null): number {
  if (!fechaIngreso) return 0;
  return Math.floor((new Date().getTime() - new Date(fechaIngreso).getTime()) / (365.25 * 24 * 3600 * 1000));
}

interface Override { sueldo_transferencia?: number; sueldo_efectivo?: number; bono?: number }

export default function NominaPage() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [nomina, setNomina] = useState<NominaMensual[]>([]);
  const [params, setParams] = useState<ParamMap>({});
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [emp, nom, par] = await Promise.all([
        db.empleado.filter({ estatus: "Activo" }, "nombre"),
        db.nomina_mensual.filter({ mes, anio }),
        db.parametro.list("clave"),
      ]);
      setEmpleados(emp);
      setParams(paramsToObject(par));

      let nomData = nom;
      if (nom.length === 0) {
        const opsCrear = emp.map((e) => {
          const st = Number(e.sueldo_transferencia_mes || 0);
          const se = Number(e.sueldo_efectivo_mes || 0);
          const sueldoTotal = st + se;
          const anios = calcAnios(e.fecha_ingreso);
          const diasVac = anios >= 20 ? 20 : anios >= 15 ? 18 : anios >= 10 ? 16 : anios >= 6 ? 14 : anios >= 4 ? 12 : 6;
          const aguinaldo = anio === new Date().getFullYear() && mes === 12 ? sueldoTotal / 30 * 15 : 0;
          const vacaciones = sueldoTotal / 30 * diasVac * 1.25 / 12;
          return db.nomina_mensual.create({
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
        nomData = await db.nomina_mensual.filter({ mes, anio });
      }
      setNomina(nomData);

      const ov: Record<string, Override> = {};
      nomData.forEach((n) => {
        ov[n.empleado_id] = {
          sueldo_transferencia: n.sueldo_transferencia,
          sueldo_efectivo: n.sueldo_efectivo,
          bono: n.bono || 0,
        };
      });
      setOverrides(ov);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [mes, anio]);

  useEffect(() => {
    load();
  }, [load]);

  const getVal = (emp: Empleado, key: keyof Override): number => {
    const ov = overrides[emp.id]?.[key];
    if (ov !== undefined) return Number(ov);
    if (key === "sueldo_transferencia") return Number(emp.sueldo_transferencia_mes || 0);
    if (key === "sueldo_efectivo") return Number(emp.sueldo_efectivo_mes || 0);
    return 0;
  };

  const autoguardar = async (empId: string) => {
    const emp = empleados.find((e) => e.id === empId);
    if (!emp) return;
    const st = getVal(emp, "sueldo_transferencia");
    const se = getVal(emp, "sueldo_efectivo");
    const sueldoTotal = st + se;
    const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
    // Prima vacacional: provisión mensual (prima_anual / 12)
    let vacaciones = 0;
    if (emp.fecha_ingreso && sueldoTotal > 0) {
      const anios = calcAnios(emp.fecha_ingreso);
      if (anios >= 1) {
        const diasVac = diasVacacionesLFT(anios);
        vacaciones = Math.round(((sueldoTotal / 30) * diasVac * 0.25) / 12);
      }
    }
    const bono = overrides[empId]?.bono ?? 0;
    const existente = nomina.find((n) => n.empleado_id === empId);
    const data = {
      empleado_id: empId,
      empleado_nombre: emp.nombre,
      anio, mes,
      sueldo_transferencia: st,
      sueldo_efectivo: se,
      aguinaldo, vacaciones, bono,
    };
    try {
      if (existente) await db.nomina_mensual.update(existente.id, data);
      else await db.nomina_mensual.create(data);
    } catch (err: any) {
      toast.error(err?.message || "Error en autoguardado");
    }
  };

  const setVal = (empId: string, key: keyof Override, val: string | number) => {
    setOverrides((prev) => ({ ...prev, [empId]: { ...prev[empId], [key]: Number(val) } }));
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => autoguardar(empId), 500);
  };

  // Recalcula los sueldos del mes filtrado leyendo sueldo_transferencia_mes
  // y sueldo_efectivo_mes del catálogo de empleados. NO toca aguinaldo/bono.
  const [recalculando, setRecalculando] = useState(false);
  const recalcularDesdeCatalogo = async () => {
    if (!confirm("¿Sobrescribir los sueldos de este mes con los del catálogo de empleados?")) return;
    setRecalculando(true);
    try {
      for (const emp of empleados) {
        const st = Number(emp.sueldo_transferencia_mes || 0);
        const se = Number(emp.sueldo_efectivo_mes || 0);
        const existente = nomina.find((n) => n.empleado_id === emp.id);
        if (existente) {
          await db.nomina_mensual.update(existente.id, {
            sueldo_transferencia: st,
            sueldo_efectivo: se,
            empleado_nombre: emp.nombre,
          });
        } else {
          await db.nomina_mensual.create({
            empleado_id: emp.id,
            empleado_nombre: emp.nombre,
            anio, mes,
            sueldo_transferencia: st, sueldo_efectivo: se,
            aguinaldo: 0, vacaciones: 0, bono: 0,
          });
        }
      }
      toast.success(`Sueldos recalculados desde catálogo (${empleados.length} empleados)`);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al recalcular");
    } finally {
      setRecalculando(false);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const emp of empleados) {
        const st = getVal(emp, "sueldo_transferencia");
        const se = getVal(emp, "sueldo_efectivo");
        const sueldoTotal = st + se;
        const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
        // Prima vacacional: provisión mensual (prima_anual / 12)
        let vacaciones = 0;
        if (emp.fecha_ingreso && sueldoTotal > 0) {
          const anios = calcAnios(emp.fecha_ingreso);
          if (anios >= 1) {
            const diasVac = diasVacacionesLFT(anios);
            vacaciones = Math.round(((sueldoTotal / 30) * diasVac * 0.25) / 12);
          }
        }
        const bono = overrides[emp.id]?.bono ?? 0;
        const existente = nomina.find((n) => n.empleado_id === emp.id);
        const data = {
          empleado_id: emp.id,
          empleado_nombre: emp.nombre,
          anio, mes,
          sueldo_transferencia: st, sueldo_efectivo: se,
          aguinaldo, vacaciones, bono,
        };
        if (existente) await db.nomina_mensual.update(existente.id, data);
        else await db.nomina_mensual.create(data);
      }
      toast.success("Nómina guardada");
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const isnRate = Number(params.isn_nl ?? 0.03);

  const rows = empleados.map((emp) => {
    const st = getVal(emp, "sueldo_transferencia");
    const se = getVal(emp, "sueldo_efectivo");
    const sueldoTotal = st + se;
    const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;

    // Prima vacacional: provisión MENSUAL = prima_anual / 12.
    // Prima anual = (salario_diario × días vac LFT) × 25% (LFT Art. 80).
    // Se prorratea cada mes para reflejar el costo mensual aunque se pague
    // efectivamente en el mes aniversario.
    let primaVac = 0;
    let diasVac = 0;
    if (emp.fecha_ingreso && sueldoTotal > 0) {
      const anios = calcAnios(emp.fecha_ingreso);
      if (anios >= 1) {
        diasVac = diasVacacionesLFT(anios);
        const primaAnual = (sueldoTotal / 30) * diasVac * 0.25;
        primaVac = Math.round(primaAnual / 12);
      }
    }

    const bono = overrides[emp.id]?.bono ?? 0;

    // Deducciones patronales: gross-up del NETO transferencia (lo declarado)
    // usando tabla LISR Art. 96 + IMSS con UMA y SBC + Infonavit 5%.
    // El sueldo efectivo NO se declara y por tanto no genera impuestos.
    let bruto = 0, imss = 0, isn = 0, isrRetenido = 0, infonavit = 0;
    if (st > 0) {
      const n = calcularNominaDesdeNeto(st, { formaPago: "Transferencia" });
      bruto = n.bruto;
      imss = n.imssPatronal;
      isrRetenido = n.isrRetenido;
      infonavit = n.infonavitPatronal;
      isn = Math.round(bruto * isnRate);
    }

    const totalEgreso = st + se + aguinaldo + primaVac + bono + imss + isn + infonavit;
    return { emp, st, se, sueldoTotal, aguinaldo, primaVac, bono, imss, isn, isrRetenido, infonavit, totalEgreso, diasVac, bruto };
  });

  const totales = rows.reduce((acc, r) => ({
    st: acc.st + r.st, se: acc.se + r.se, sueldoTotal: acc.sueldoTotal + r.sueldoTotal,
    aguinaldo: acc.aguinaldo + r.aguinaldo, primaVac: acc.primaVac + r.primaVac,
    bono: acc.bono + r.bono,
    imss: acc.imss + r.imss, isn: acc.isn + r.isn, isrRetenido: acc.isrRetenido + r.isrRetenido,
    infonavit: acc.infonavit + r.infonavit,
    totalEgreso: acc.totalEgreso + r.totalEgreso,
  }), { st: 0, se: 0, sueldoTotal: 0, aguinaldo: 0, primaVac: 0, bono: 0, imss: 0, isn: 0, isrRetenido: 0, infonavit: 0, totalEgreso: 0 });

  return (
    <div className="p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Nómina</h1>
        <div className="flex items-center gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          <button onClick={recalcularDesdeCatalogo} disabled={recalculando || loading}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-3 py-2 rounded-xl disabled:opacity-60"
            title="Sobrescribe sueldos de este mes con los del catálogo de empleados (no toca aguinaldo/bono)">
            <RefreshCw size={14} className={recalculando ? "animate-spin" : ""} />
            {recalculando ? "Recalculando..." : "Recalcular sueldos"}
          </button>
          <button onClick={saveAll} disabled={saving}
            className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar Nómina"}
          </button>
        </div>
      </div>

      <div className="mb-3 text-xs text-stone-400 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2 space-y-0.5">
        <p>Los valores de sueldo están prellenados desde el catálogo de empleados. Puedes modificarlos aquí si hay variación en el mes.</p>
        <p>
          <strong>IMSS Patronal, ISR Retenido, Infonavit</strong> se calculan con gross-up oficial:
          tabla LISR Art. 96 mensual + IMSS por SBC (UMA {(118.50).toFixed(2)}) + Infonavit 5% del SBC mensual.
          <strong> ISN</strong> = bruto × {(isnRate * 100).toFixed(0)}%.
          <strong> Prima Vac.</strong> = provisión mensual = (prima_anual / 12), donde prima_anual = (sueldo/30) × días vac. LFT × 25%.
        </p>
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
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Bono <span className="text-stone-300 font-normal">(efvo.)</span></th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Prima Vac.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">IMSS Pat.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">ISN</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">ISR Ret.</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Infonavit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total Egreso</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-stone-400">Cargando...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-stone-400">Sin empleados activos</td></tr>
              ) : (
                rows.map(({ emp, st, se, sueldoTotal, aguinaldo, primaVac, imss, isn, isrRetenido, infonavit, totalEgreso, diasVac }) => (
                  <tr key={emp.id} className="border-t border-stone-50 hover:bg-stone-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-stone-800">{emp.nombre}</p>
                      <p className="text-xs text-stone-400">{emp.puesto}</p>
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" min="0" value={st}
                        onChange={(e) => setVal(emp.id, "sueldo_transferencia", e.target.value)}
                        className="w-28 border border-stone-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-violet-200" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="number" min="0" value={se}
                        onChange={(e) => setVal(emp.id, "sueldo_efectivo", e.target.value)}
                        className="w-28 border border-stone-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-violet-200" />
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-stone-700">{fmtMXN(sueldoTotal)}</td>
                    <td className="px-4 py-3 text-right text-stone-600">{mes === 12 ? fmtMXN(aguinaldo) : "—"}</td>
                    <td className="px-4 py-2">
                      <input type="number" min="0" value={overrides[emp.id]?.bono ?? 0}
                        onChange={(e) => setVal(emp.id, "bono", e.target.value)}
                        className="w-28 border border-stone-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-violet-200" />
                    </td>
                    <td className="px-4 py-3 text-right text-stone-600" title={diasVac > 0 ? `${diasVac} días vac. × 25%` : undefined}>
                      {primaVac > 0 ? fmtMXN(primaVac) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-600">{fmtMXN(imss)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{fmtMXN(isn)}</td>
                    <td className="px-4 py-3 text-right text-stone-500">{fmtMXN(isrRetenido)}</td>
                    <td className="px-4 py-3 text-right text-stone-500">{fmtMXN(infonavit)}</td>
                    <td className="px-4 py-3 text-right font-bold text-stone-800">{fmtMXN(totalEgreso)}</td>
                  </tr>
                ))
              )}
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
                  <td className="px-4 py-3 text-right font-bold text-stone-700">{fmtMXN(totales.primaVac)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{fmtMXN(totales.imss)}</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600">{fmtMXN(totales.isn)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-500">{fmtMXN(totales.isrRetenido)}</td>
                  <td className="px-4 py-3 text-right font-bold text-stone-500">{fmtMXN(totales.infonavit)}</td>
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
