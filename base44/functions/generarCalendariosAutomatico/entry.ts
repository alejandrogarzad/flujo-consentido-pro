import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DIAS_KEY = ["lunes","martes","miercoles","jueves","viernes","sabado","domingo"];

function generarCalendario(anio, mes, horario = {}, excepciones = "") {
  const celdas = [];
  const primerDia = new Date(anio, mes - 1, 1).getDay();
  const diasMes = new Date(anio, mes, 0).getDate();
  
  let fila = Array(primerDia).fill(null);
  for (let d = 1; d <= diasMes; d++) {
    const diaSemana = (primerDia + d - 1) % 7;
    const diaKey = DIAS_KEY[diaSemana];
    const tieneHorario = !!horario[diaKey];
    const esExcepcion = excepciones.split(',').map(s => Number(s.trim())).includes(d);
    
    if (esExcepcion) {
      fila.push({ dia: d, tipo: "excepcion", diaSemana });
    } else if (tieneHorario) {
      fila.push({ dia: d, tipo: "sesion", hora: horario[diaKey], diaSemana });
    } else {
      fila.push({ dia: d, tipo: "vacio", diaSemana });
    }
    
    if (fila.length === 7) {
      celdas.push(fila);
      fila = [];
    }
  }
  if (fila.length > 0) {
    while (fila.length < 7) fila.push(null);
    celdas.push(fila);
  }
  
  const totalSesiones = celdas.flat().filter(c => c?.tipo === "sesion").length;
  return { celdas, totalSesiones };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const paciente_id = body.paciente_id || body.event?.entity_id || body.data?.id;

    if (!paciente_id) {
      return Response.json({ error: 'Missing paciente_id' }, { status: 400 });
    }

    // Obtener paciente y parámetros
    let paciente;
    try {
      paciente = await base44.asServiceRole.entities.Paciente.get(paciente_id);
    } catch (err) {
      console.error('Error fetching paciente:', err.message);
      return Response.json({ error: `Paciente ${paciente_id} not found: ${err.message}` }, { status: 404 });
    }
    
    if (!paciente) {
      return Response.json({ error: `Paciente ${paciente_id} not found` }, { status: 404 });
    }

    const params = await base44.asServiceRole.entities.Parametro.list();
    const paramsObj = Object.fromEntries(params.map(p => [p.clave, p.valor]));
    
    const precioRegularGlobal = Number(paramsObj.precio_terapia_regular || 1100);
    const precioMatutinoGlobal = Number(paramsObj.precio_terapia_matutina || 900);
    const ivaRate = Number(paramsObj.iva || 0.16);
    
    const precioRegular = Number(paciente.precio_sesion_regular) || precioRegularGlobal;
    const precioMatutino = Number(paciente.precio_sesion_matutina) || precioMatutinoGlobal;

    const hoy = new Date();
    const anioActual = hoy.getFullYear();
    const anioInicioPac = paciente.anio_inicio || anioActual;
    const mesInicio = (anioInicioPac < anioActual) ? 1 : (paciente.mes_inicio || hoy.getMonth() + 1);

    // Generar calendarios desde el mes de inicio, respetando el alta del paciente
    const mesAltaLimite = (paciente.mes_alta && Number(paciente.anio_alta) === anioActual) ? paciente.mes_alta : 12;
    for (let mes = mesInicio; mes <= mesAltaLimite; mes++) {
      const horario = paciente.dias_sesion || {};
      const tipoSesion = paciente.tipo_sesion || {};
      const terapeutas = paciente.terapeutas || {};
      const excepciones = "";
      
      const { celdas, totalSesiones } = generarCalendario(anioActual, mes, horario, excepciones);
      
      // Calcular montos
      let montoEfectivo = 0;
      let sesionesReg = 0, sesionesMatutinas = 0;
      
      celdas.flat().forEach(celda => {
        if (celda?.tipo !== "sesion") return;
        const diaKey = DIAS_KEY[celda.diaSemana];
        const tipo = tipoSesion[diaKey] || "Regular";
        if (tipo === "Matutina") {
          sesionesMatutinas++;
          montoEfectivo += precioMatutino;
        } else {
          sesionesReg++;
          montoEfectivo += precioRegular;
        }
      });
      
      const montoTransferencia = Math.round(montoEfectivo * (1 + ivaRate));
      
      // Buscar si ya existe calendario para este mes
      const existente = await base44.asServiceRole.entities.CalendarioPaciente.filter({
        paciente_id,
        anio: anioActual,
        mes
      });
      
      const calendarData = {
        paciente_id,
        paciente_nombre: paciente.nombre,
        anio: anioActual,
        mes,
        horario,
        tipo_sesion: tipoSesion,
        terapeutas,
        excepciones,
        reposiciones: [],
        total_sesiones: totalSesiones,
        sesiones_regulares: sesionesReg,
        sesiones_matutinas: sesionesMatutinas,
        reposiciones_count: 0,
        monto_efectivo: montoEfectivo,
        monto_transferencia: montoTransferencia,
      };
      
      if (existente.length > 0) {
        // Si hay múltiples (por duplicados), eliminar los sin cambios
        if (existente.length > 1) {
          for (let i = 1; i < existente.length; i++) {
            const horarioIgual = JSON.stringify(existente[i].horario || {}) === JSON.stringify(horario || {});
            if (horarioIgual) {
              // Es un duplicado auto-generado, eliminar
              await base44.asServiceRole.entities.CalendarioPaciente.delete(existente[i].id);
            }
          }
          // Re-obtener después de limpiar
          existente = await base44.asServiceRole.entities.CalendarioPaciente.filter({
            paciente_id,
            anio: anioActual,
            mes
          });
        }
        
        // Usar el que tiene cambios manuales, o el primero si no hay cambios
        const existCalendar = existente[0];
        const horarioIgual = JSON.stringify(existCalendar.horario || {}) === JSON.stringify(horario || {});
        
        if (horarioIgual) {
          // Sin cambios manuales: regenerar todo
          await base44.asServiceRole.entities.CalendarioPaciente.update(existCalendar.id, {
            ...calendarData,
            reposiciones: existCalendar.reposiciones || [],
            reposiciones_count: existCalendar.reposiciones_count || 0,
          });
        } else {
          // Tiene cambios manuales: solo actualizar montos y sesiones
          await base44.asServiceRole.entities.CalendarioPaciente.update(existCalendar.id, {
            total_sesiones: calendarData.total_sesiones,
            sesiones_regulares: calendarData.sesiones_regulares,
            sesiones_matutinas: calendarData.sesiones_matutinas,
            monto_efectivo: calendarData.monto_efectivo,
            monto_transferencia: calendarData.monto_transferencia,
          });
        }
      } else {
        // Crear nuevo
        await base44.asServiceRole.entities.CalendarioPaciente.create(calendarData);
      }
    }

    return Response.json({ success: true, message: 'Calendarios generados automáticamente' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});