import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin access required' }),
        { status: 403 }
      );
    }

    const body = await req.json();
    const mes = Number(body.mes);
    const anio = Number(body.anio);

    if (!mes || !anio) {
      return new Response(
        JSON.stringify({ error: 'mes y anio requeridos' }),
        { status: 400 }
      );
    }

    // Listar todos los pacientes
    const pacientes = await base44.asServiceRole.entities.Paciente.list();

    // Filtro unificado: paciente aplica si (1) tiene mes_inicio/anio_inicio Y está dentro del rango
    // (2) NO tiene fecha de alta posterior ya pasada
    const pacientesAplicables = pacientes.filter(p => {
      if (!p.mes_inicio || !p.anio_inicio) return false;
      
      const inicioVal = p.anio_inicio * 100 + p.mes_inicio;
      const mesAnoVal = anio * 100 + mes;
      if (inicioVal > mesAnoVal) return false;
      
      if (p.mes_alta && p.anio_alta) {
        const altaVal = p.anio_alta * 100 + p.mes_alta;
        if (altaVal < mesAnoVal) return false;
      }
      
      return true;
    });

    // Listar calendarios ya guardados para este mes/año
    const calendariosSaved = await base44.asServiceRole.entities.CalendarioPaciente.filter({
      mes,
      anio,
    });
    const savedSet = new Set(calendariosSaved.map(c => c.paciente_id));

    // Helper: generar calendario mensual
    function generarCalendario(a, m, horarioSemanal, excepcionesStr) {
      const excepciones = (excepcionesStr || '')
        .split(',')
        .map(d => parseInt(d.trim()))
        .filter(d => !isNaN(d));

      const diasEnMes = new Date(a, m, 0).getDate();
      const primerDia = new Date(a, m - 1, 1).getDay();
      const offset = (primerDia + 6) % 7;

      const celdas = [];
      let diaActual = 1;

      for (let fila = 0; fila < 6; fila++) {
        const semana = [];
        for (let col = 0; col < 7; col++) {
          const idx = fila * 7 + col;
          if (idx < offset || diaActual > diasEnMes) {
            semana.push({ dia: null, tipo: 'vacio' });
          } else {
            const dia = diaActual;
            const weekday = col;
            const keys = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
            const hora = horarioSemanal[keys[weekday]];

            if (excepciones.includes(dia)) {
              semana.push({ dia, tipo: 'excepcion', diaSemana: weekday });
            } else if (hora) {
              semana.push({ dia, tipo: 'sesion', hora, diaSemana: weekday });
            } else {
              semana.push({ dia, tipo: 'libre', diaSemana: weekday });
            }
            diaActual++;
          }
        }
        celdas.push(semana);
      }

      const totalSesiones = celdas.flat().filter(c => c.tipo === 'sesion').length;
      return { celdas, totalSesiones };
    }

    const creados = [];
    const omitidos = [];
    const ops = [];

    for (const pac of pacientesAplicables) {
      if (savedSet.has(pac.id)) {
        omitidos.push(pac.nombre);
        continue;
      }

      const horario = pac.dias_sesion || {
        lunes: '',
        martes: '',
        miercoles: '',
        jueves: '',
        viernes: '',
        sabado: '',
        domingo: '',
      };

      const tipoSesion = pac.tipo_sesion || {
        lunes: 'Regular',
        martes: 'Regular',
        miercoles: 'Regular',
        jueves: 'Regular',
        viernes: 'Regular',
        sabado: 'Regular',
        domingo: 'Regular',
      };

      const terapeutas = pac.terapeutas || {
        lunes: '',
        martes: '',
        miercoles: '',
        jueves: '',
        viernes: '',
        sabado: '',
        domingo: '',
      };

      const { celdas, totalSesiones } = generarCalendario(anio, mes, horario, '');

      const DIAS_KEY = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      let sesReg = 0, sesMat = 0;
      celdas.flat().forEach(c => {
        if (c.tipo !== 'sesion') return;
        const diaKey = DIAS_KEY[c.diaSemana];
        if ((tipoSesion?.[diaKey] || 'Regular') === 'Matutina') sesMat++;
        else sesReg++;
      });

      const precioGlobal = Number(pac.precio_sesion_regular || 1100);
      const ivaRate = 0.16;
      const montoEfectivo = totalSesiones * precioGlobal;
      const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));

      const data = {
        paciente_id: pac.id,
        paciente_nombre: pac.nombre,
        anio,
        mes,
        horario,
        tipo_sesion: tipoSesion,
        terapeutas,
        excepciones: '',
        reposiciones: [],
        total_sesiones: totalSesiones,
        sesiones_regulares: sesReg,
        sesiones_matutinas: sesMat,
        reposiciones_count: 0,
        monto_efectivo: montoEfectivo,
        monto_transferencia: montoTransferencia,
      };

      creados.push(pac.nombre);
      ops.push(base44.asServiceRole.entities.CalendarioPaciente.create(data));
    }

    await Promise.all(ops);

    return new Response(
      JSON.stringify({
        success: true,
        mes,
        anio,
        creados: creados.length,
        omitidos: omitidos.length,
        total_revisados: pacientesAplicables.length,
        pacientes_creados: creados,
        pacientes_omitidos: omitidos,
      }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    );
  }
});