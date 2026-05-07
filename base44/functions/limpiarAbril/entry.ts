import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Obtener todos los pagos de Abril 2026
    const todosPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
    const pagosAbril = todosPagos.filter(p => p.mes === 4 && (p.anio === 2026 || !p.anio));

    // Agrupar por paciente, mantener solo el más reciente
    const deduped = {};
    pagosAbril.forEach(p => {
      const key = p.paciente_id;
      if (!deduped[key] || new Date(p.updated_date || p.created_date) > new Date(deduped[key].updated_date || deduped[key].created_date)) {
        deduped[key] = p;
      }
    });

    // Identificar duplicados a eliminar
    const idsAEliminar = pagosAbril
      .filter(p => !Object.values(deduped).find(d => d.id === p.id))
      .map(p => p.id);

    // Eliminar duplicados
    if (idsAEliminar.length > 0) {
      await Promise.all(idsAEliminar.map(id => base44.entities.PagoTerapia.delete(id)));
    }

    return Response.json({
      message: `Limpieza completada. Se eliminaron ${idsAEliminar.length} registros duplicados.`,
      eliminados: idsAEliminar.length,
      mantenidos: Object.keys(deduped).length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});