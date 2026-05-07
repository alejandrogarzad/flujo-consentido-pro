import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { fmtMXN, paramsToObject, MESES, TARIFA_ISR, diasVacacionesLFT } from "@/lib/calculos";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// UMA 2026 por mes
const UMA_2026 = {
  1: 113.14, 2: 117.31, 3: 117.31, 4: 117.31, 5: 117.31, 6: 117.31,
  7: 117.31, 8: 117.31, 9: 117.31, 10: 117.31, 11: 117.31, 12: 117.31
};

// Gross-up iterativo: neto → bruto con ISR + cuota obrera IMSS - subsidio
function calcularBruto(neto) {
  let bruto = neto * 1.15;
  for (let i = 0; i < 15; i++) {
    const tarifa = TARIFA_ISR.find(t => bruto >= t.li && bruto <= t.ls);
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

// Calcula SBC diario/mensual y cuota patronal mensual IMSS
function calcularIMSSMensual(bruto, mes, diasCotizados = 30) {
  const uma = UMA_2026[mes] || 117.31;
  const sbcDiario = Math.min((bruto * 1.0452) / 30.4, uma * 25);
  const sbcMensual = sbcDiario * diasCotizados;
  
  // Cuota fija EyM: 20.40% × UMA × días cotizados / 30 (por empleado)
  const cuotaFija = (uma * 0.2040) * (diasCotizados / 30);
  
  // Excedente: 1.10% si SBC diario > 3 UMA
  const excedente = sbcDiario > uma * 3 ? (sbcMensual - uma * 3 * diasCotizados / 30) * 0.011 : 0;
  
  // Otros componentes (% del SBC mensual) - tasas correctas
  const prestacionesDinero = sbcMensual * 0.0070; // 0.70% patrón
  const gastosMedicos = sbcMensual * 0.0105; // 1.05% patrón
  const invalidezVida = sbcMensual * 0.0175; // 1.75% patrón
  const riesgosTrabajoTasa = 0.0050; // 0.50% clase I (riesgos de trabajo)
  const riesgosTrabajo = sbcMensual * riesgosTrabajoTasa;
  const guarderias = sbcMensual * 0.0100; // 1.00% patrón
  
  // Total patronal: cuota fija + excedente + componentes porcentuales
  const totalPatronal = cuotaFija + excedente + prestacionesDinero + gastosMedicos + invalidezVida + riesgosTrabajo + guarderias;
  
  // Cuotas obreras
  const cuotaObreraBasica = sbcMensual * 0.02375; // 2.375% de SBC
  const obreraPrestaciones = sbcMensual * 0.0025;
  const obreraMedicos = sbcMensual * 0.00375;
  const obreraSegurosVida = sbcMensual * 0.00625;
  const totalObrera = cuotaObreraBasica + obreraPrestaciones + obreraMedicos + obreraSegurosVida;
  
  return { sbcDiario, sbcMensual, patronal: Math.round(totalPatronal), obrera: Math.round(totalObrera) };
}

// Calcula cuota bimestral RCV + Infonavit (patrón 2% + 5.331% + 5% = 12.331%)
function calcularRCVInfBimestral(sbcMensual1, sbcMensual2, mes) {
  const sbcBim = sbcMensual1 + sbcMensual2;
  const retiro = sbcBim * 0.0200; // 2.00% retiro
  const cesantia = sbcBim * 0.05331; // 5.331% cesantía y vejez 2026
  const infonavit = sbcBim * 0.0500; // 5.00% infonavit
  const totalBim = retiro + cesantia + infonavit;
  return Math.round(totalBim);
}

// Helper: calcular años de antigüedad
function calcAnios(fechaIngreso) {
  if (!fechaIngreso) return 0;
  return Math.floor((new Date() - new Date(fechaIngreso)) / (365.25 * 24 * 3600 * 1000));
}

// Prima vacacional SOLO en mes aniversario (LFT Art. 80)
function calcularPrimaVacacionalMes(empleado, mes, anio) {
  if (!empleado.fecha_ingreso) return 0;
  const fechaIngreso = new Date(empleado.fecha_ingreso);
  const mesAniversario = fechaIngreso.getMonth() + 1;
  if (mes !== mesAniversario) return 0;
  const antiguedad = anio - fechaIngreso.getFullYear();
  if (antiguedad < 1) return 0;
  const diasVac = diasVacacionesLFT(antiguedad);
  const sueldoTotal = (Number(empleado.sueldo_transferencia_mes || 0) + Number(empleado.sueldo_efectivo_mes || 0));
  const salarioDiario = sueldoTotal / 30;
  return Math.round(diasVac * salarioDiario * 0.25); // 0.25 = 25% prima
}

// Calcular nómina de un mes: itera empleados activos del catálogo
// Si existe NominaMensual guardada, usa valores guardados; si no, calcula desde el catálogo
// Prima vacacional: solo en mes aniversario (mes de cumpleaños laboral)
// RETORNA SOLO EL EFECTIVO PAGADO (st + se + aguinaldo + vacaciones + bono), SIN IMPUESTOS
function calcularNominaMes(mes, anio, empleadosCatalogo, nominaData, factorBrutoNeto, imssRate, isnRate) {
  return empleadosCatalogo.reduce((total, emp) => {
    const nomMesEmp = nominaData.find(nm => nm.empleado_id === emp.id && nm.mes === mes && nm.anio === anio);
    
    let st, se, aguinaldo, vacaciones, bono;
    if (nomMesEmp) {
      // Usar valores guardados
      st = Number(nomMesEmp.sueldo_transferencia || 0);
      se = Number(nomMesEmp.sueldo_efectivo || 0);
      aguinaldo = Number(nomMesEmp.aguinaldo || 0);
      vacaciones = Number(nomMesEmp.vacaciones || 0);
      bono = Number(nomMesEmp.bono || 0);
    } else {
      // Calcular desde catálogo
      st = Number(emp.sueldo_transferencia_mes || 0);
      se = Number(emp.sueldo_efectivo_mes || 0);
      const sueldoTotal = st + se;
      const anios = calcAnios(emp.fecha_ingreso);
      const diasVac = diasVacacionesLFT(anios);
      aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
      // Prima vacacional: solo en mes aniversario
      const mesAniversario = emp.fecha_ingreso ? new Date(emp.fecha_ingreso).getMonth() + 1 : null;
      vacaciones = mesAniversario === mes ? sueldoTotal / 30 * diasVac * 1.25 : 0;
      bono = 0;
    }
    
    // Solo retornar el efectivo pagado, sin impuestos (que se calcularán por separado)
    return total + st + se + aguinaldo + vacaciones + bono;
  }, 0);
}

// Tabla de vencimientos 2026 con ajustes por fin de semana/festivo
function getVencimientosIMSS() {
  return {
    1: { vencimiento: 17, cierra: 12, bimClausura: 6 }, // cierra dic + bim 6
    2: { vencimiento: 17, cierra: 1, bimClausura: 0 },
    3: { vencimiento: 17, cierra: 2, bimClausura: 1 },
    4: { vencimiento: 20, cierra: 3, bimClausura: 0 }, // 17 es sábado
    5: { vencimiento: 18, cierra: 4, bimClausura: 2 }, // 17 es domingo
    6: { vencimiento: 17, cierra: 5, bimClausura: 0 },
    7: { vencimiento: 17, cierra: 6, bimClausura: 3 },
    8: { vencimiento: 17, cierra: 7, bimClausura: 0 },
    9: { vencimiento: 17, cierra: 8, bimClausura: 4 },
    10: { vencimiento: 19, cierra: 9, bimClausura: 0 }, // 17 es sábado
    11: { vencimiento: 17, cierra: 10, bimClausura: 5 },
    12: { vencimiento: 17, cierra: 11, bimClausura: 0 }
  };
}

export default function FlujoEfectivo() {
  const [params, setParams] = useState({});
  const [pagos, setPagos] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [nomina, setNomina] = useState([]);
  const [subarr, setSubarr] = useState([]);
  const [empleadosCatalogo, setEmpleadosCatalogo] = useState([]);
  const [saldoInicial, setSaldoInicial] = useState(100000);
  const [loading, setLoading] = useState(true);
  const [impuestosOverride, setImpuestosOverride] = useState({});
  const [reservaRCV, setReservaRCV] = useState({});

  useEffect(() => {
    Promise.all([
      base44.entities.Parametro.list(),
      base44.entities.PagoTerapia.list(),
      base44.entities.Evento.list(),
      base44.entities.Gasto.list(),
      base44.entities.NominaMensual.list(), // BUG 1: Fetch fresco de nóminas en cada montaje
      base44.entities.Subarrendamiento.list(),
      base44.entities.Empleado.filter({ estatus: "Activo" }),
    ]).then(async ([p, pg, ev, g, n, s, emps]) => {
      const par = paramsToObject(p);
      const hoy = new Date();
      const mesActual = hoy.getMonth() + 1;

      // Auto-generar nómina faltante para meses completados (1 a mesActual-1)
      const mesesFaltantes = [];
      for (let m = 1; m < mesActual; m++) {
        if (!n.find(nom => nom.mes === m && nom.anio === 2026)) {
          mesesFaltantes.push(m);
        }
      }

      if (mesesFaltantes.length > 0) {
        const factorBrutoNeto = Number(par.factor_bruto_neto || 1.10);
        const imssRate = Number(par.imss_patronal || 0.30);
        const isnRate = Number(par.isn_nl || 0.03);

        const opsCrear = mesesFaltantes.map(mes =>
          Promise.all(
            emps.map(emp => {
              const st = Number(emp.sueldo_transferencia_mes || 0);
              const se = Number(emp.sueldo_efectivo_mes || 0);
              const sueldoTotal = st + se;
              const aguinaldo = mes === 12 ? sueldoTotal / 30 * 15 : 0;
              // Prima vacacional: solo en mes aniversario
              const mesAniversario = emp.fecha_ingreso ? new Date(emp.fecha_ingreso).getMonth() + 1 : null;
              const anios = calcAnios(emp.fecha_ingreso);
              const diasVac = diasVacacionesLFT(anios);
              const vacaciones = mesAniversario === mes ? sueldoTotal / 30 * diasVac * 1.25 : 0;
              return base44.entities.NominaMensual.create({
                empleado_id: emp.id,
                empleado_nombre: emp.nombre,
                anio: 2026,
                mes,
                sueldo_transferencia: st,
                sueldo_efectivo: se,
                aguinaldo,
                vacaciones,
                bono: 0,
              });
            })
          )
        );

        await Promise.all(opsCrear);
        // Recargar nómina fresca después de crear
        const nNew = await base44.entities.NominaMensual.list();
        setNomina(nNew);
      } else {
        setNomina(n);
      }

      setParams(par);
      setSaldoInicial(Number(par.saldo_inicial_caja || 100000));
      setPagos(pg);
      setEventos(ev);
      setGastos(g);
      setSubarr(s);
      setEmpleadosCatalogo(emps);
      setLoading(false);
    });
  }, []);

  // Calcular reserva RCV en useEffect, no dentro del map
  // Suscribirse a cambios en nóminas para invalidar cache
  useEffect(() => {
    const unsub = base44.entities.NominaMensual.subscribe(() => {
      base44.entities.NominaMensual.list().then(setNomina);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const hoy = new Date();
    const mesActual = hoy.getMonth() + 1;
    const newReserva = {};
    for (let mes = 1; mes <= 12; mes++) {
      const nomMesDataIMSS = nomina.filter(nm => nm.mes === mes && nm.anio === 2026);
      let imssPatronal = 0;
      let rcvInfonavitMes = 0;
      
      if (nomMesDataIMSS.length > 0) {
        nomMesDataIMSS.forEach(nm => {
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
          const bimMeses = {
            1: [1, 2], 2: [3, 4], 3: [5, 6],
            4: [7, 8], 5: [9, 10], 6: [11, 12]
          }[bimNum];
          
          let sbcBim1 = 0, sbcBim2 = 0;
          [bimMeses[0], bimMeses[1]].forEach(m => {
            const nomMesBim = nomina.filter(nm => nm.mes === m && nm.anio === 2026);
            nomMesBim.forEach(nm => {
              const st = Number(nm.sueldo_transferencia || 0);
              if (st > 0) {
                const bruto = calcularBruto(st);
                const { sbcMensual } = calcularIMSSMensual(bruto, m);
                if (m === bimMeses[0]) sbcBim1 += sbcMensual;
                else sbcBim2 += sbcMensual;
              }
            });
          });
          rcvInfonavitMes = calcularRCVInfBimestral(sbcBim1, sbcBim2, mes);
        }
      }
      
      newReserva[mes] = rcvInfonavitMes > 0 ? rcvInfonavitMes / 2 : imssPatronal * 0.3;
    }
    setReservaRCV(newReserva);
  }, [nomina]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" /></div>;

  const factorBrutoNeto = Number(params.factor_bruto_neto || 1.10);
  const imssRate = Number(params.imss_patronal || 0.30);
  const isnRate = Number(params.isn_nl || 0.03);
  const isrRetenidoRate = Number(params.isr_retenido_empleados || 0.06);

  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;

  // Calcular promedios de meses completados (meses anteriores al actual)
  // IMPORTANTE: prima vacacional NO se amortiza (se paga UNA VEZ en mes aniversario)
  const mesesCompletos = mesActual - 1;
  let sumTer = 0, sumCit = 0, sumSub = 0, sumGastos = 0;
  let sumSueldos = 0, sumAguinaldo = 0, sumBono = 0;
  for (let i = 1; i <= mesesCompletos; i++) {
    sumTer += pagos.filter(p => p.mes === i && p.anio === 2026).reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
    sumCit += eventos.filter(ev => { const d = new Date(ev.fecha); return d.getMonth() + 1 === i && d.getFullYear() === 2026; }).reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);
    sumSub += subarr.filter(s => s.mes === i && s.anio === 2026).reduce((s, x) => s + Number(x.monto_cobrado || 0), 0);
    sumGastos += gastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() + 1 === i && d.getFullYear() === 2026; }).reduce((s, g) => s + Number(g.monto || 0), 0);
    // Desglosar nómina en componentes (prima NO se promedia)
    const nomMeses = nomina.filter(nm => nm.mes === i && nm.anio === 2026);
    nomMeses.forEach(nm => {
      sumSueldos += Number(nm.sueldo_transferencia || 0) + Number(nm.sueldo_efectivo || 0);
      sumAguinaldo += Number(nm.aguinaldo || 0);
      sumBono += Number(nm.bono || 0);
    });
  }
  const n = mesesCompletos || 1;
  const prom = {
    ter: sumTer / n, cit: sumCit / n, sub: sumSub / n, gastos: sumGastos / n,
    sueldos: sumSueldos / n, aguinaldo: sumAguinaldo / n, bono: sumBono / n
  };
  const promSueldosMes = mesesCompletos > 0 ? sumSueldos / mesesCompletos : 0;

  let saldoAcum = saldoInicial;

  // Calcular promedio de IVA facturado de meses completados (sin override)
  const ivaPromCalc = (() => {
    const ivasReales = [];
    for (let m = 1; m < mesActual; m++) {
      const pagoConIVA = pagos.filter(p => p.mes === m && p.anio === 2026 && ["Transferencia", "Tarjeta", "Depósito"].includes(p.forma_pago))
        .reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
      const eventosConIVA = eventos.filter(ev => {
        const d = new Date(ev.fecha);
        return d.getMonth() + 1 === m && d.getFullYear() === 2026 && ["Transferencia", "Tarjeta", "Depósito"].includes(ev.forma_pago);
      }).reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);
      const ivaM = Math.round((pagoConIVA + eventosConIVA) * (Number(params.iva || 0.16)));
      if (ivaM > 0) ivasReales.push(ivaM);
    }
    return ivasReales.length > 0 ? Math.round(ivasReales.reduce((s, v) => s + v, 0) / ivasReales.length) : 0;
  })();

  const mesData = MESES.map((_, i) => {
    const mes = i + 1;
    const esProyeccion = mes > mesActual;

    let ingresosTerapias = pagos.filter(p => p.mes === mes && p.anio === 2026).reduce((sum, p) => sum + Number(p.monto_pagado || 0), 0);
    let ingresosCitas = eventos.filter(ev => { const d = new Date(ev.fecha); return d.getMonth() + 1 === mes && d.getFullYear() === 2026; }).reduce((sum, ev) => sum + Number(ev.monto_pagado || 0), 0);
    let ingresosSubarr = subarr.filter(s => s.mes === mes && s.anio === 2026).reduce((sum, s) => sum + Number(s.monto_cobrado || 0), 0);

    if (esProyeccion) {
      ingresosTerapias = prom.ter;
      ingresosCitas = prom.cit;
      ingresosSubarr = prom.sub;
    }
    const totalIngresos = ingresosTerapias + ingresosCitas + ingresosSubarr;

    // Calcular impuestos automáticamente
    const ivaRate = Number(params.iva || 0.16);
    const isrRetRate = Number(params.isr_retenido_empleados || 0.06);
    const imssRate = Number(params.imss_patronal || 0.30);
    const isnRate = Number(params.isn_nl || 0.03);
    const factorBrutoNeto = Number(params.factor_bruto_neto || 1.10);

    const getImpuestoData = (k, defaultVal) => impuestosOverride[`${mes}_${k}`] !== undefined ? impuestosOverride[`${mes}_${k}`] : defaultVal;

    // Calcular impuestos de nómina (IMSS, ISR, ISN)
    let stTotalBruto = 0;
    const nomMesData = nomina.filter(nm => nm.mes === mes && nm.anio === 2026);
    if (nomMesData.length > 0) {
      stTotalBruto = nomMesData.reduce((s, nm) => s + (Number(nm.sueldo_transferencia || 0) * factorBrutoNeto), 0);
    } else {
      stTotalBruto = empleadosCatalogo.reduce((s, e) => s + (Number(e.sueldo_transferencia_mes || 0) * factorBrutoNeto), 0);
    }

    // IVA: solo sobre lo facturado (transfer, tarjeta, depósito), o promedio si es proyección
    let ivaCalculado;
    if (esProyeccion) {
      ivaCalculado = ivaPromCalc;
    } else {
      const pagoConIVA = pagos.filter(p => p.mes === mes && p.anio === 2026 && ["Transferencia", "Tarjeta", "Depósito"].includes(p.forma_pago))
        .reduce((s, p) => s + Number(p.monto_pagado || 0), 0);
      const eventosConIVA = eventos.filter(ev => {
        const d = new Date(ev.fecha);
        return d.getMonth() + 1 === mes && d.getFullYear() === 2026 && ["Transferencia", "Tarjeta", "Depósito"].includes(ev.forma_pago);
      }).reduce((s, ev) => s + Number(ev.monto_pagado || 0), 0);
      ivaCalculado = Math.round((pagoConIVA + eventosConIVA) * ivaRate);
    }
    const ivaReal = getImpuestoData("iva", ivaCalculado);

    // IMSS: usar total de nómina guardada o calcular desde empleados (simple: st * factor * imssRate)
    const nomMesDataIMSS = nomina.filter(nm => nm.mes === mes && nm.anio === 2026);
    let imssPatronal = 0;
    
    if (nomMesDataIMSS.length > 0) {
      // Usar el total de sueldo transferencia guardado × factor × tasa
      const stTotal = nomMesDataIMSS.reduce((s, nm) => s + Number(nm.sueldo_transferencia || 0), 0);
      imssPatronal = Math.round(stTotal * factorBrutoNeto * imssRate);
    } else {
      // Si no hay nómina guardada, calcular desde empleados del catálogo
      const stTotal = empleadosCatalogo.reduce((s, e) => s + Number(e.sueldo_transferencia_mes || 0), 0);
      imssPatronal = Math.round(stTotal * factorBrutoNeto * imssRate);
    }
    
    // RCV + Infonavit: bimestral simplificado (12.331% del SBC bimestral estimado)
    let rcvInfonavitMes = 0;
    const vencimientos = getVencimientosIMSS();
    if (vencimientos[mes].bimClausura > 0) {
      const bimNum = vencimientos[mes].bimClausura;
      const bimMeses = {
        1: [1, 2], 2: [3, 4], 3: [5, 6],
        4: [7, 8], 5: [9, 10], 6: [11, 12]
      }[bimNum];
      
      // SBC bimestral ≈ (sueldo_transferencia × factor bruto/neto)
      let sbcBimEstimado = 0;
      bimMeses.forEach(m => {
        const nomMes = nomina.filter(nm => nm.mes === m && nm.anio === 2026);
        if (nomMes.length > 0) {
          const stMes = nomMes.reduce((s, nm) => s + Number(nm.sueldo_transferencia || 0), 0);
          sbcBimEstimado += stMes * factorBrutoNeto;
        } else if (m <= mesActual) {
          // Mes completado sin nómina guardada: usar catálogo
          const stMes = empleadosCatalogo.reduce((s, e) => s + Number(e.sueldo_transferencia_mes || 0), 0);
          sbcBimEstimado += stMes * factorBrutoNeto;
        } else {
          // Mes futuro: usar promedio de meses anteriores (sueldos solamente para SBC)
          sbcBimEstimado += promSueldosMes * factorBrutoNeto;
        }
      });
      
      // Cuota bimestral 12.331% (2% + 5.331% + 5%)
      rcvInfonavitMes = Math.round(sbcBimEstimado * 0.12331);
    }
    
    const imssReal = getImpuestoData("imss", imssPatronal);
    
    // Provisión de reserva RCV/Infonavit (acumular mitad bimestral cada mes)
    let reservaAcumulada = 0;
    let reservaLiberada = 0;
    for (let m = 1; m < mes; m++) {
      const vencimientos = getVencimientosIMSS();
      const provisión = (reservaRCV[m] || 0);
      reservaAcumulada += provisión;
      if (vencimientos[m].bimClausura > 0) {
        reservaLiberada = reservaAcumulada;
        reservaAcumulada = 0;
      }
    }

    // ISR Personas Físicas (Actividad Empresarial) - sobre ingresos netos - editable
    const isrEmpresarialReal = getImpuestoData("isr_empresarial", 0);

    // ISN (sobre nómina bruta)
    const isnCalculado = Math.round(stTotalBruto * isnRate);
    const isnReal = getImpuestoData("isn", isnCalculado);

    let egresosGastos = gastos.filter(g => { const d = new Date(g.fecha); return d.getMonth() + 1 === mes && d.getFullYear() === 2026; }).reduce((sum, g) => sum + Number(g.monto || 0), 0);
    
    // BUG 2: Calcular nómina pagada en tiempo real: sueldos + prima (SOLO mes aniversario) + aguinaldo + impuestos patronales
    let egresosSueldos = 0, egresosPrima = 0, egresosAguinaldo = 0, egresosBono = 0, egresosIMSSNomina = 0, egresosISN = 0;
    const nomMesSueldos = nomina.filter(nm => nm.mes === mes && nm.anio === 2026);
    if (nomMesSueldos.length > 0) {
      nomMesSueldos.forEach(nm => {
        const st = Number(nm.sueldo_transferencia || 0);
        const se = Number(nm.sueldo_efectivo || 0);
        egresosSueldos += st + se;
        // Prima vacacional: SOLO en mes aniversario
        egresosPrima += calcularPrimaVacacionalMes(empleadosCatalogo.find(e => e.id === nm.empleado_id), mes, 2026) || 0;
        if (mes === 12) egresosAguinaldo += Number(nm.aguinaldo || 0);
        if (mes === 12) egresosBono += Number(nm.bono || 0);

        // Calcular impuestos patronales sobre sueldo transferencia
        if (st > 0) {
          const bruto = calcularBruto(st);
          const { patronal } = calcularIMSSMensual(bruto, mes);
          egresosIMSSNomina += patronal;
        }
      });
      egresosISN = Math.round(nomMesSueldos.reduce((s, nm) => s + (Number(nm.sueldo_transferencia || 0) * factorBrutoNeto), 0) * isnRate);
    } else if (esProyeccion) {
      egresosSueldos = prom.sueldos;
      // Prima NO se proyecta (se calcula mes a mes según aniversarios)
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

  return (
    <div className="p-6 max-w-full">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-stone-800">Flujo de Efectivo 2026</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-stone-500">Saldo Inicial Caja (Ene):</label>
          <input type="number" value={saldoInicial} onChange={e => setSaldoInicial(Number(e.target.value))}
            className="w-32 border border-stone-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
          <span className="text-xs text-stone-400">(Solo vista — guarda en Parámetros para persistir)</span>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 mb-6">
        <h2 className="text-sm font-semibold text-stone-600 mb-4">Evolución del Saldo de Caja</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={mesData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={v => fmtMXN(v)} />
            <Line dataKey="saldoFinal" name="Saldo Final" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="ingresos" name="Ingresos" stroke="#22c55e" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            <Line dataKey="egresos" name="Egresos" stroke="#f87171" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
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
              {[
                { label: "Saldo Inicial", key: "saldoInicial", bold: true, color: "text-violet-600" },
                { label: "(+) Terapias Cobradas", key: "ingresosTerapias", color: "text-green-600" },
                { label: "(+) Citas / Eval Cobradas", key: "ingresosCitas", color: "text-green-600" },
                { label: "(+) Subarrendamiento Cobrado", key: "ingresosSubarr", color: "text-green-600" },
                { label: "= Total Ingresos", key: "ingresos", bold: true, color: "text-green-700", border: true },
                { label: "(-) Gastos Pagados", key: "egresosGastos", color: "text-red-500" },
                { label: "(-) Sueldos Pagados", key: "egresosSueldos", color: "text-red-500" },
                { label: "(-) Prima Vacacional", key: "egresosPrima", color: "text-red-500" },
                { label: "(-) Aguinaldos (Diciembre)", key: "egresosAguinaldo", color: "text-red-500" },
                { label: "(-) Bonos Objetivos (Diciembre)", key: "egresosBono", color: "text-red-500" },
                { label: "(-) IMSS Patronal Nómina", key: "egresosIMSSNomina", color: "text-orange-500" },
                { label: "(-) ISN Nómina", key: "egresosISN", color: "text-orange-500" },
                { label: "(-) IVA Pagado", key: "ivaReal", color: "text-orange-500", editable: true, hint: "Varía según SAT" },
                { label: "(-) IMSS Patronal", key: "imssReal", color: "text-orange-500", editable: true },
                { label: "(-) RCV + Infonavit", key: "rcvInfonavitMes", color: "text-orange-500", editable: true },
                { label: "(-) ISR Actividad Empresarial", key: "isrEmpresarialReal", color: "text-orange-500", editable: true },
                { label: "(-) ISN", key: "isnReal", color: "text-orange-500", editable: true },
                { label: "= Total Egresos", key: "egresos", bold: true, color: "text-red-600", border: true },
                { label: "Reserva RCV/Infonavit (acumulada)", key: "reservaRCV", color: "text-blue-500", editable: false },
                { label: "Flujo Neto del Mes", key: "neto", bold: true, color: "" },
                { label: "SALDO FINAL", key: "saldoFinal", bold: true, highlight: true },
              ].map(row => (
                <tr key={row.key} className={`border-t border-stone-50 ${row.highlight ? "bg-violet-50" : row.border ? "bg-stone-50" : "hover:bg-stone-50/50"}`}>
                  <td className={`px-4 py-2.5 ${row.bold ? "font-bold text-stone-700" : "text-stone-600"}`}>{row.label}</td>
                  {mesData.map((m, i) => {
                   const val = m[row.key];
                   const color = row.highlight ? (val >= 0 ? "text-violet-700" : "text-red-700") :
                                 row.color || (val >= 0 ? "text-stone-700" : "text-red-600");
                   return (
                     <td key={i} className={`px-2 py-2.5 text-right text-xs ${row.bold ? "font-bold" : ""} ${color} ${m.esProyeccion ? "bg-amber-50/40" : ""}`}>
                       {row.editable ? (
                         <input
                           type="number"
                           value={val}
                           onChange={e => setImpuestosOverride(prev => ({
                             ...prev,
                             [`${i + 1}_${row.key}`]: Number(e.target.value)
                           }))}
                           className="w-20 border border-orange-200 rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
                         />
                       ) : (
                         fmtMXN(val)
                       )}
                     </td>
                   );
                  })}
                  <td className={`px-4 py-2.5 text-right font-bold text-xs ${row.highlight ? "text-violet-700" : "text-stone-700"}`}>
                    {/* Saldo Inicial y Saldo Final: mostrar el del primer/último mes respectivamente, no sumar */}
                    {row.key === "saldoFinal"
                      ? fmtMXN(mesData[mesData.length - 1]?.saldoFinal || 0)
                      : row.key === "saldoInicial"
                      ? fmtMXN(mesData[0]?.saldoInicial || 0)
                      : fmtMXN(mesData.reduce((sum, m) => sum + (m[row.key] || 0), 0))
                    }
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