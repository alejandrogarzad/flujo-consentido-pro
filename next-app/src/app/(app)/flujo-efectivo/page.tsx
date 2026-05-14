"use client";

import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { db } from "@/lib/db";
import {
  fmtMXN, paramsToObject, MESES, TARIFA_ISR, diasVacacionesLFT, parseFechaLocal,
  type ParamMap,
} from "@/lib/calculos";
import type { Empleado, Evento, FormaPago, Gasto, NominaMensual, PagoTerapia, Subarrendamiento } from "@/types/db";

const UMA_2026: Record<number, number> = {
  1: 113.14, 2: 117.31, 3: 117.31, 4: 117.31, 5: 117.31, 6: 117.31,
  7: 117.31, 8: 117.31, 9: 117.31, 10: 117.31, 11: 117.31, 12: 117.31,
};

function calcularBruto(neto: number): number {
  let bruto = neto * 1.15;
  for (let i = 0; i < 15; i++) {
    const tarifa = TARIFA_ISR.find((t) => bruto >= t.li && bruto <= t.ls);
    if (!tarifa) break;
    const isr = tarifa.cuota + (bruto - tarifa.li) * tarifa.tasa;
    const sbcDiario = (bruto * 1.0452) / 30.4;
    const cuotaObrera = sbcDiario * 30.4 * 0.02375;
    const subsidio = bruto >= 8952.50 && bruto <= 125291.61 ? Math.min(300, bruto * 0.06) : 0;
    const bruteCalc = neto + isr + cuotaObrera - subsidio;
    if (Math.abs(bruteCalc - bruto) < 0.5) break;
    bruto = bruteCalc;
  }
  return bruto;
}

function calcularIMSSMensual(bruto: number, mes: number, diasCotizados = 30) {
  const uma = UMA_2026[mes] || 117.31;
  const sbcDiario = Math.min((bruto * 1.0452) / 30.4, uma * 25);
  const sbcMensual = sbcDiario * diasCotizados;
  const cuotaFija = (uma * 0.2040) * (diasCotizados / 30);
  const excedente = sbcDiario > uma * 3 ? (sbcMensual - uma * 3 * diasCotizados / 30) * 0.011 : 0;
  const prestacionesDinero = sbcMensual * 0.0070;
  const gastosMedicos = sbcMensual * 0.0105;
  const invalidezVida = sbcMensual * 0.0175;
  const riesgosTrabajo = sbcMensual * 0.0050;
  const guarderias = sbcMensual * 0.0100;
  const totalPatronal = cuotaFija + excedente + prestacionesDinero + gastosMedicos + invalidezVida + riesgosTrabajo + guarderias;
  const cuotaObreraBasica = sbcMensual * 0.02375;
  const obreraPrestaciones = sbcMensual * 0.0025;
  const obreraMedicos = sbcMensual * 0.00375;
  const obreraSegurosVida = sbcMensual * 0.00625;
  const totalObrera = cuotaObreraBasica + obreraPrestaciones + obreraMedicos + obreraSegurosVida;
  return { sbcDiario, sbcMensual, patronal: Math.round(totalPatronal), obrera: Math.round(totalObrera) };
}

function calcularRCVInfBimestral(sbcMensual1: number, sbcMensual2: number): number {
  const sbcBim = sbcMensual1 + sbcMensual2;
  return Math.round(sbcBim * 0.12331);
}

function calcAnios(fechaIngreso: string | null): number {
  if (!fechaIngreso) return 0;
  return Math.floor((new Date().getTime() - new Date(fechaIngreso).getTime()) / (365.25 * 24 * 3600 * 1000));
}

function calcularPrimaVacacionalMes(empleado: Empleado | undefined, mes: number, anio: number): number {
  if (!empleado || !empleado.fecha_ingreso) return 0;
  const fechaIngreso = new Date(empleado.fecha_ingreso);
  if (mes !== fechaIngreso.getMonth() + 1) return 0;
  const antiguedad = anio - fechaIngreso.getFullYear();
  if (antiguedad < 1) return 0;
  const diasVac = diasVacacionesLFT(antiguedad);
  const sueldoTotal = Number(empleado.sueldo_transferencia_mes || 0) + Number(empleado.sueldo_efectivo_mes || 0);
  return Math.round(diasVac * (sueldoTotal / 30) * 0.25);
}

function getVencimientosIMSS() {
  return {
    1: { vencimiento: 17, cierra: 12, bimClausura: 6 },
    2: { vencimiento: 17, cierra: 1, bimClausura: 0 },
    3: { vencimiento: 17, cierra: 2, bimClausura: 1 },
    4: { vencimiento: 20, cierra: 3, bimClausura: 0 },
    5: { vencimiento: 18, cierra: 4, bimClausura: 2 },
    6: { vencimiento: 17, cierra: 5, bimClausura: 0 },
    7: { vencimiento: 17, cierra: 6, bimClausura: 3 },
    8: { vencimiento: 17, cierra: 7, bimClausura: 0 },
    9: { vencimiento: 17, cierra: 8, bimClausura: 4 },
    10: { vencimiento: 19, cierra: 9, bimClausura: 0 },
    11: { vencimiento: 17, cierra: 10, bimClausura: 5 },
    12: { vencimiento: 17, cierra: 11, bimClausura: 0 },
  } as Record<number, { vencimiento: number; cierra: number; bimClausura: number }>;
}

const CON_IVA_FORMAS: FormaPago[] = ["Transferencia", "Tarjeta", "Depósito"];

export default function FlujoEfectivoPage() {
  const [params, setParams] = useState<ParamMap>({});
  const [pagos, setPagos] = useState<PagoTerapia[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [nomina, setNomina] = useState<NominaMensual[]>([]);
  const [subarr, setSubarr] = useState<Subarrendamiento[]>([]);
  const [empleadosCatalogo, setEmpleadosCatalogo] = useState<Empleado[]>([]);
  const [saldoInicial, setSaldoInicial] = useState(100000);
  const [loading, setLoading] = useState(true);
  const [impuestosOverride, setImpuestosOverride] = useState<Record<string, number>>({});
  const [reservaRCV, setReservaRCV] = useState<Record<number, number>>({});

  const ANIO = new Date().getFullYear();

  useEffect(() => {
    Promise.all([
      db.parametro.list("clave"),
      db.pago_terapia.list(),
      db.evento.list(),
      db.gasto.list(),
      db.nomina_mensual.list(),
      db.subarrendamiento.list(),
      db.empleado.filter({ estatus: "Activo" }, "nombre"),
    ])
      .then(async ([p, pg, ev, g, n, s, emps]) => {
        const par = paramsToObject(p);
        const hoy = new Date();
        const mesActual = hoy.getMonth() + 1;

        const mesesFaltantes: number[] = [];
        for (let m = 1; m < mesActual; m++) {
          if (!n.find((nom) => nom.mes === m && nom.anio === ANIO)) mesesFaltantes.push(m);
        }

        if (mesesFaltantes.length > 0) {
          for (const mes of mesesFaltantes) {
            await Promise.all(emps.map((emp) => {
              const st = Number(emp.sueldo_transferencia_mes || 0);
              const se = Number(emp.sueldo_efectivo_mes || 0);
              const sueldoTotal = st + se;
              const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
              const mesAniversario = emp.fecha_ingreso ? new Date(emp.fecha_ingreso).getMonth() + 1 : null;
              const anios = calcAnios(emp.fecha_ingreso);
              const diasVac = diasVacacionesLFT(anios);
              const vacaciones = mesAniversario === mes ? sueldoTotal / 30 * diasVac * 1.25 : 0;
              return db.nomina_mensual.create({
                empleado_id: emp.id,
                empleado_nombre: emp.nombre,
                anio: ANIO, mes,
                sueldo_transferencia: st,
                sueldo_efectivo: se,
                aguinaldo, vacaciones, bono: 0,
              });
            }));
          }
          const nNew = await db.nomina_mensual.list();
          setNomina(nNew);
        } else {
          setNomina(n);
        }

        setParams(par);
        setSaldoInicial(Number(par.saldo_inicial_caja ?? 100000));
        setPagos(pg);
        setEventos(ev);
        setGastos(g);
        setSubarr(s);
        setEmpleadosCatalogo(emps);
      })
      .catch((err: any) => toast.error(err?.message || "Error al cargar"))
      .finally(() => setLoading(false));
  }, [ANIO]);

  useEffect(() => {
    const unsubs = [
      db.nomina_mensual.subscribe(() => db.nomina_mensual.list().then(setNomina)),
      db.gasto.subscribe(() => db.gasto.list().then(setGastos)),
      db.pago_terapia.subscribe(() => db.pago_terapia.list().then(setPagos)),
      db.evento.subscribe(() => db.evento.list().then(setEventos)),
      db.subarrendamiento.subscribe(() => db.subarrendamiento.list().then(setSubarr)),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const newReserva: Record<number, number> = {};
    for (let mes = 1; mes <= 12; mes++) {
      const nomMesDataIMSS = nomina.filter((nm) => nm.mes === mes && nm.anio === ANIO);
      let imssPatronal = 0;
      let rcvInfonavitMes = 0;
      if (nomMesDataIMSS.length > 0) {
        nomMesDataIMSS.forEach((nm) => {
          const st = Number(nm.sueldo_transferencia || 0);
          if (st > 0) {
            const bruto = calcularBruto(st);
            const { patronal } = calcularIMSSMensual(bruto, mes);
            imssPatronal += patronal;
          }
        });
        const vencimientos = getVencimientosIMSS();
        if (mes <= mesActual && vencimientos[mes].bimClausura > 0) {
          const bimNum = vencimientos[mes].bimClausura;
          const bimMeses = ({ 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 10], 6: [11, 12] } as Record<number, number[]>)[bimNum];
          let sbcBim1 = 0;
          let sbcBim2 = 0;
          [bimMeses[0], bimMeses[1]].forEach((m) => {
            const nomMesBim = nomina.filter((nm) => nm.mes === m && nm.anio === ANIO);
            nomMesBim.forEach((nm) => {
              const st = Number(nm.sueldo_transferencia || 0);
              if (st > 0) {
                const bruto = calcularBruto(st);
                const { sbcMensual } = calcularIMSSMensual(bruto, m);
                if (m === bimMeses[0]) sbcBim1 += sbcMensual;
                else sbcBim2 += sbcMensual;
              }
            });
          });
          rcvInfonavitMes = calcularRCVInfBimestral(sbcBim1, sbcBim2);
        }
      }
      newReserva[mes] = rcvInfonavitMes > 0 ? rcvInfonavitMes / 2 : imssPatronal * 0.3;
    }
    setReservaRCV(newReserva);
  }, [nomina, ANIO]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  const factorBrutoNeto = Number(params.factor_bruto_neto ?? 1.10);
  const imssRate = Number(params.imss_patronal ?? 0.30);
  const isnRate = Number(params.isn_nl ?? 0.03);

  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;

  const mesesCompletos = mesActual - 1;
  let sumTer = 0; let sumCit = 0; let sumSub = 0; let sumGastos = 0;
  let sumSueldos = 0; let sumAguinaldo = 0; let sumBono = 0;
  for (let i = 1; i <= mesesCompletos; i++) {
    sumTer += pagos.filter((p) => p.mes === i && p.anio === ANIO).reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
    sumCit += eventos.filter((ev) => { const d = (parseFechaLocal(ev.fecha) ?? new Date(0)); return d.getMonth() + 1 === i && d.getFullYear() === ANIO; }).reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);
    sumSub += subarr.filter((s) => s.mes === i && s.anio === ANIO).reduce((acc, x) => acc + Number(x.monto_cobrado || 0), 0);
    sumGastos += gastos.filter((g) => { const d = (parseFechaLocal(g.fecha) ?? new Date(0)); return d.getMonth() + 1 === i && d.getFullYear() === ANIO; }).reduce((s, g) => s + Number(g.monto || 0), 0);
    nomina.filter((nm) => nm.mes === i && nm.anio === ANIO).forEach((nm) => {
      sumSueldos += Number(nm.sueldo_transferencia || 0) + Number(nm.sueldo_efectivo || 0);
      sumAguinaldo += Number(nm.aguinaldo || 0);
      sumBono += Number(nm.bono || 0);
    });
  }
  const n = mesesCompletos || 1;
  const prom = { ter: sumTer / n, cit: sumCit / n, sub: sumSub / n, gastos: sumGastos / n, sueldos: sumSueldos / n, aguinaldo: sumAguinaldo / n, bono: sumBono / n };
  const promSueldosMes = mesesCompletos > 0 ? sumSueldos / mesesCompletos : 0;

  let saldoAcum = saldoInicial;

  const ivaPromCalc = (() => {
    const ivasReales: number[] = [];
    for (let m = 1; m < mesActual; m++) {
      const pagoConIVA = pagos.filter((p) => p.mes === m && p.anio === ANIO && CON_IVA_FORMAS.includes(p.forma_pago))
        .reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
      const eventosConIVA = eventos.filter((ev) => {
        const d = (parseFechaLocal(ev.fecha) ?? new Date(0));
        return d.getMonth() + 1 === m && d.getFullYear() === ANIO && CON_IVA_FORMAS.includes(ev.forma_pago);
      }).reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);
      const ivaM = Math.round((pagoConIVA + eventosConIVA) * Number(params.iva ?? 0.16));
      if (ivaM > 0) ivasReales.push(ivaM);
    }
    return ivasReales.length > 0 ? Math.round(ivasReales.reduce((s, v) => s + v, 0) / ivasReales.length) : 0;
  })();

  const mesData = MESES.map((_, i) => {
    const mes = i + 1;
    const esProyeccion = mes > mesActual;

    let ingresosTerapias = pagos.filter((p) => p.mes === mes && p.anio === ANIO).reduce((sum, p) => sum + Number(p.monto_pagado || 0), 0);
    let ingresosCitas = eventos.filter((ev) => { const d = (parseFechaLocal(ev.fecha) ?? new Date(0)); return d.getMonth() + 1 === mes && d.getFullYear() === ANIO; }).reduce((sum, ev) => sum + Number(ev.monto_pagado || 0), 0);
    let ingresosSubarr = subarr.filter((s) => s.mes === mes && s.anio === ANIO).reduce((sum, s) => sum + Number(s.monto_cobrado || 0), 0);

    if (esProyeccion) {
      ingresosTerapias = prom.ter;
      ingresosCitas = prom.cit;
      ingresosSubarr = prom.sub;
    }
    const totalIngresos = ingresosTerapias + ingresosCitas + ingresosSubarr;

    const ivaRate = Number(params.iva ?? 0.16);

    const getOverride = (k: string, defaultVal: number) =>
      impuestosOverride[`${mes}_${k}`] !== undefined ? impuestosOverride[`${mes}_${k}`] : defaultVal;

    let stTotalBruto = 0;
    const nomMesData = nomina.filter((nm) => nm.mes === mes && nm.anio === ANIO);
    if (nomMesData.length > 0) {
      stTotalBruto = nomMesData.reduce((s, nm) => s + Number(nm.sueldo_transferencia || 0) * factorBrutoNeto, 0);
    } else {
      stTotalBruto = empleadosCatalogo.reduce((s, e) => s + Number(e.sueldo_transferencia_mes || 0) * factorBrutoNeto, 0);
    }

    let ivaCalculado: number;
    if (esProyeccion) {
      ivaCalculado = ivaPromCalc;
    } else {
      const pagoConIVA = pagos.filter((p) => p.mes === mes && p.anio === ANIO && CON_IVA_FORMAS.includes(p.forma_pago))
        .reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
      const eventosConIVA = eventos.filter((ev) => {
        const d = (parseFechaLocal(ev.fecha) ?? new Date(0));
        return d.getMonth() + 1 === mes && d.getFullYear() === ANIO && CON_IVA_FORMAS.includes(ev.forma_pago);
      }).reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);
      ivaCalculado = Math.round((pagoConIVA + eventosConIVA) * ivaRate);
    }
    const ivaReal = getOverride("iva", ivaCalculado);

    const nomMesDataIMSS = nomina.filter((nm) => nm.mes === mes && nm.anio === ANIO);
    let imssPatronal = 0;
    if (nomMesDataIMSS.length > 0) {
      const stTotal = nomMesDataIMSS.reduce((s, nm) => s + Number(nm.sueldo_transferencia || 0), 0);
      imssPatronal = Math.round(stTotal * factorBrutoNeto * imssRate);
    } else {
      const stTotal = empleadosCatalogo.reduce((s, e) => s + Number(e.sueldo_transferencia_mes || 0), 0);
      imssPatronal = Math.round(stTotal * factorBrutoNeto * imssRate);
    }

    let rcvInfonavitMes = 0;
    const vencimientos = getVencimientosIMSS();
    if (vencimientos[mes].bimClausura > 0) {
      const bimNum = vencimientos[mes].bimClausura;
      const bimMeses = ({ 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 10], 6: [11, 12] } as Record<number, number[]>)[bimNum];
      let sbcBimEstimado = 0;
      bimMeses.forEach((m) => {
        const nomMes = nomina.filter((nm) => nm.mes === m && nm.anio === ANIO);
        if (nomMes.length > 0) {
          const stMes = nomMes.reduce((s, nm) => s + Number(nm.sueldo_transferencia || 0), 0);
          sbcBimEstimado += stMes * factorBrutoNeto;
        } else if (m <= mesActual) {
          const stMes = empleadosCatalogo.reduce((s, e) => s + Number(e.sueldo_transferencia_mes || 0), 0);
          sbcBimEstimado += stMes * factorBrutoNeto;
        } else {
          sbcBimEstimado += promSueldosMes * factorBrutoNeto;
        }
      });
      rcvInfonavitMes = Math.round(sbcBimEstimado * 0.12331);
    }

    const imssReal = getOverride("imss", imssPatronal);

    let reservaAcumulada = 0;
    for (let m = 1; m < mes; m++) {
      const v = getVencimientosIMSS();
      reservaAcumulada += reservaRCV[m] || 0;
      if (v[m].bimClausura > 0) reservaAcumulada = 0;
    }

    const isrEmpresarialReal = getOverride("isr_empresarial", 0);
    const isnCalculado = Math.round(stTotalBruto * isnRate);
    const isnReal = getOverride("isn", isnCalculado);

    let egresosGastos = gastos.filter((g) => { const d = (parseFechaLocal(g.fecha) ?? new Date(0)); return d.getMonth() + 1 === mes && d.getFullYear() === ANIO; }).reduce((sum, g) => sum + Number(g.monto || 0), 0);
    if (esProyeccion) egresosGastos = prom.gastos;

    let egresosSueldos = 0; let egresosPrima = 0; let egresosAguinaldo = 0; let egresosBono = 0; let egresosIMSSNomina = 0; let egresosISN = 0;
    const nomMesSueldos = nomina.filter((nm) => nm.mes === mes && nm.anio === ANIO);
    if (nomMesSueldos.length > 0) {
      nomMesSueldos.forEach((nm) => {
        const st = Number(nm.sueldo_transferencia || 0);
        const se = Number(nm.sueldo_efectivo || 0);
        egresosSueldos += st + se;
        egresosPrima += calcularPrimaVacacionalMes(empleadosCatalogo.find((e) => e.id === nm.empleado_id), mes, ANIO);
        if (mes === 12) egresosAguinaldo += Number(nm.aguinaldo || 0);
        if (mes === 12) egresosBono += Number(nm.bono || 0);
        if (st > 0) {
          const bruto = calcularBruto(st);
          const { patronal } = calcularIMSSMensual(bruto, mes);
          egresosIMSSNomina += patronal;
        }
      });
      egresosISN = Math.round(nomMesSueldos.reduce((s, nm) => s + Number(nm.sueldo_transferencia || 0) * factorBrutoNeto, 0) * isnRate);
    } else if (esProyeccion) {
      egresosSueldos = prom.sueldos;
      egresosPrima = 0;
      if (mes === 12) {
        egresosAguinaldo = prom.aguinaldo;
        egresosBono = prom.bono;
      }
    }

    const totalEgresos = egresosGastos + egresosSueldos + egresosPrima + egresosAguinaldo + egresosBono + egresosIMSSNomina + egresosISN + ivaReal + imssReal + rcvInfonavitMes + isrEmpresarialReal + isnReal;
    const saldoAnterior = saldoAcum;
    saldoAcum += totalIngresos - totalEgresos;

    return {
      mes: MESES[i].substring(0, 3),
      esProyeccion,
      saldoInicial: Math.round(saldoAnterior),
      ingresos: Math.round(totalIngresos),
      egresos: Math.round(totalEgresos),
      neto: Math.round(totalIngresos - totalEgresos),
      saldoFinal: Math.round(saldoAcum),
      ingresosTerapias: Math.round(ingresosTerapias),
      ingresosCitas: Math.round(ingresosCitas),
      ingresosSubarr: Math.round(ingresosSubarr),
      egresosGastos: Math.round(egresosGastos),
      egresosSueldos: Math.round(egresosSueldos),
      egresosPrima: Math.round(egresosPrima),
      egresosAguinaldo: Math.round(egresosAguinaldo),
      egresosBono: Math.round(egresosBono),
      egresosIMSSNomina: Math.round(egresosIMSSNomina),
      egresosISN: Math.round(egresosISN),
      ivaReal: Math.round(ivaReal),
      imssReal: Math.round(imssReal),
      rcvInfonavitMes: Math.round(rcvInfonavitMes),
      isrEmpresarialReal: Math.round(isrEmpresarialReal),
      isnReal: Math.round(isnReal),
      reservaRCV: Math.round(reservaAcumulada),
    };
  });

  type MesRow = (typeof mesData)[number];
  type MesKey = keyof MesRow;

  const rowDefs: { label: string; key: MesKey; bold?: boolean; color?: string; border?: boolean; editable?: boolean; highlight?: boolean }[] = [
    { label: "Saldo Inicial", key: "saldoInicial", bold: true, color: "text-violet-600" },
    { label: "(+) Terapias Cobradas", key: "ingresosTerapias", color: "text-green-600" },
    { label: "(+) Citas / Eval Cobradas", key: "ingresosCitas", color: "text-green-600" },
    { label: "(+) Subarrendamiento Cobrado", key: "ingresosSubarr", color: "text-green-600" },
    { label: "= Total Ingresos", key: "ingresos", bold: true, color: "text-green-700", border: true },
    { label: "(-) Gastos Pagados", key: "egresosGastos", color: "text-red-500" },
    { label: "(-) Sueldos Pagados", key: "egresosSueldos", color: "text-red-500" },
    { label: "(-) Prima Vacacional", key: "egresosPrima", color: "text-red-500" },
    { label: "(-) Aguinaldos (Diciembre)", key: "egresosAguinaldo", color: "text-red-500" },
    { label: "(-) Bonos (Diciembre)", key: "egresosBono", color: "text-red-500" },
    { label: "(-) IMSS Patronal Nómina", key: "egresosIMSSNomina", color: "text-orange-500" },
    { label: "(-) ISN Nómina", key: "egresosISN", color: "text-orange-500" },
    { label: "(-) IVA Pagado", key: "ivaReal", color: "text-orange-500", editable: true },
    { label: "(-) IMSS Patronal", key: "imssReal", color: "text-orange-500", editable: true },
    { label: "(-) RCV + Infonavit", key: "rcvInfonavitMes", color: "text-orange-500", editable: true },
    { label: "(-) ISR Actividad Empresarial", key: "isrEmpresarialReal", color: "text-orange-500", editable: true },
    { label: "(-) ISN", key: "isnReal", color: "text-orange-500", editable: true },
    { label: "= Total Egresos", key: "egresos", bold: true, color: "text-red-600", border: true },
    { label: "Reserva RCV/Infonavit", key: "reservaRCV", color: "text-blue-500" },
    { label: "Flujo Neto del Mes", key: "neto", bold: true },
    { label: "SALDO FINAL", key: "saldoFinal", bold: true, highlight: true },
  ];

  return (
    <div className="p-6 max-w-full">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Flujo de Efectivo {ANIO}</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-stone-500">Saldo Inicial Caja (Ene):</label>
          <input type="number" value={saldoInicial} onChange={(e) => setSaldoInicial(Number(e.target.value))}
            className="w-32 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          <span className="text-xs text-stone-400">(Solo vista — guarda en Parámetros para persistir)</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-semibold text-stone-600 mb-4">Evolución del Saldo de Caja</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={mesData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmtMXN(v)} />
            <Line dataKey="saldoFinal" name="Saldo Final" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="ingresos" name="Ingresos" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            <Line dataKey="egresos" name="Egresos" stroke="#f87171" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-stone-500">Concepto</th>
                {mesData.map((m, i) => (
                  <th key={i} className={`px-2 py-3 text-right text-xs font-semibold ${m.esProyeccion ? "text-amber-500 bg-amber-50/50" : "text-stone-500"}`}>
                    {m.mes}{m.esProyeccion ? "*" : ""}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold text-stone-500">Total</th>
              </tr>
              <tr>
                <td colSpan={14} className="px-4 py-1.5 text-xs text-amber-600 bg-amber-50/30 italic">* Meses con asterisco son proyecciones basadas en el promedio de meses anteriores</td>
              </tr>
            </thead>
            <tbody>
              {rowDefs.map((row) => (
                <tr key={row.key} className={`border-t border-stone-50 ${row.highlight ? "bg-violet-50" : row.border ? "bg-stone-50" : "hover:bg-stone-50/50"}`}>
                  <td className={`px-4 py-2.5 ${row.bold ? "font-bold text-stone-700" : "text-stone-600"}`}>{row.label}</td>
                  {mesData.map((m, i) => {
                    const val = m[row.key] as number;
                    const color = row.highlight ? (val >= 0 ? "text-violet-700" : "text-red-700") :
                      row.color ?? (val >= 0 ? "text-stone-700" : "text-red-600");
                    return (
                      <td key={i} className={`px-2 py-2.5 text-right text-xs ${row.bold ? "font-bold" : ""} ${color} ${m.esProyeccion ? "bg-amber-50/40" : ""}`}>
                        {row.editable ? (
                          <input type="number" value={val}
                            onChange={(e) => setImpuestosOverride((prev) => ({ ...prev, [`${i + 1}_${String(row.key)}`]: Number(e.target.value) }))}
                            className="w-20 border border-orange-200 rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white" />
                        ) : (
                          fmtMXN(val)
                        )}
                      </td>
                    );
                  })}
                  <td className={`px-4 py-2.5 text-right font-bold text-xs ${row.highlight ? "text-violet-700" : "text-stone-700"}`}>
                    {row.key === "saldoFinal"
                      ? fmtMXN(mesData[mesData.length - 1]?.saldoFinal ?? 0)
                      : row.key === "saldoInicial"
                      ? fmtMXN(mesData[0]?.saldoInicial ?? 0)
                      : fmtMXN(mesData.reduce((sum, m) => sum + ((m[row.key] as number) || 0), 0))}
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
