import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    
    const paciente_id = body.data?.paciente_id;
    const mes = body.data?.mes;
    const anio = body.data?.anio;

    if (!paciente_id || !mes || !anio) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Buscar todos los calendarios del mismo mes/año/paciente
    const calendarios = await base44.asServiceRole.entities.CalendarioPaciente.filter({
      paciente_id,
      mes,
      anio
    });

    // Si hay duplicados, mantener solo el más reciente
    if (calendarios.length > 1) {
      // Ordenar por updated_date descendente
      calendarios.sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
      
      // Eliminar todos menos el más reciente
      for (let i = 1; i < calendarios.length; i++) {
        await base44.asServiceRole.entities.CalendarioPaciente.delete(calendarios[i].id);
      }
      
      console.log(`Eliminados ${calendarios.length - 1} duplicados de calendario para paciente ${paciente_id} mes ${mes}`);
    }

    return Response.json({ success: true, duplicatesRemoved: Math.max(0, calendarios.length - 1) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});