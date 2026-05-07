import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const pacientes = await base44.entities.Paciente.list("-created_date", 500);
    const inactivos = pacientes.filter(p => p.estatus !== "Activo");
    
    if (inactivos.length === 0) {
      return Response.json({ message: 'No hay pacientes inactivos', updated: 0 });
    }

    const updates = inactivos.map(p =>
      base44.entities.Paciente.update(p.id, { estatus: "Activo" })
    );
    
    await Promise.all(updates);
    
    return Response.json({ message: `Activados ${inactivos.length} pacientes`, updated: inactivos.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});