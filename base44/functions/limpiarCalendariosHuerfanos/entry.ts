import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Helper: paciente aplica en mes/año según regla unificada
function pacienteAplicaEnMes(paciente, mes, anio) {
  if (!paciente) return false;
  
  // Regla 1: Debe tener mes_inicio y anio_inicio capturados
  if (!paciente.mes_inicio || !paciente.anio_inicio) return false;
  
  // Regla 1 continuación: (anio_inicio < A O (anio_inicio = A Y mes_inicio <= M))
  const inicioVal = paciente.anio_inicio * 100 + paciente.mes_inicio;
  const mesAnoVal = anio * 100 + mes;
  if (inicioVal > mesAnoVal) return false;
  
  // Regla 2: Si tiene fecha de alta capturada, debe estar dentro del rango (anio_alta > A O (anio_alta = A Y mes_alta >= M))
  if (paciente.mes_alta && paciente.anio_alta) {
    const altaVal = paciente.anio_alta * 100 + paciente.mes_alta;
    if (altaVal < mesAnoVal) return false; // Pasó la fecha de alta
  }
  
  return true;
}

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

    // Obtener todos los calendarios y pacientes
    const [calendarios, pacientes] = await Promise.all([
      base44.asServiceRole.entities.CalendarioPaciente.list(),
      base44.asServiceRole.entities.Paciente.list("nombre", 500),
    ]);

    const pacMap = Object.fromEntries(pacientes.map(p => [p.id, p]));
    
    // Identificar calendarios huérfanos: paciente no aplica en ese mes/año
    const huerfanos = calendarios.filter(cal => {
      const pac = pacMap[cal.paciente_id];
      return !pacienteAplicaEnMes(pac, cal.mes, cal.anio);
    });

    // Eliminar calendarios huérfanos
    const deleteOps = huerfanos.map(cal =>
      base44.asServiceRole.entities.CalendarioPaciente.delete(cal.id)
    );

    if (deleteOps.length > 0) {
      await Promise.all(deleteOps);
    }

    return new Response(
      JSON.stringify({
        success: true,
        eliminados: huerfanos.length,
        total_calendarios: calendarios.length,
        calendarios_huerfanos: huerfanos.map(cal => ({
          paciente_id: cal.paciente_id,
          paciente_nombre: cal.paciente_nombre,
          mes: cal.mes,
          anio: cal.anio,
        })),
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