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

    // Sumar todos los montos pagados
    const totalTerapias = pagosAbril.reduce((sum, p) => sum + Number(p.monto_pagado || 0), 0);

    // Obtener resumen de abril
    const resumenes = await base44.entities.ResumenIngreso.filter({ anio: 2026, mes: 4 });
    const resumenAbril = resumenes[0];

    if (resumenAbril) {
      // Actualizar con el monto correcto
      await base44.entities.ResumenIngreso.update(resumenAbril.id, {
        terapias: totalTerapias,
      });
    } else {
      // Crear si no existe
      await base44.entities.ResumenIngreso.create({
        anio: 2026,
        mes: 4,
        terapias: totalTerapias,
        citas: 0,
        evaluaciones: 0,
        subarrendamiento: 0,
        otros: 0,
      });
    }

    return Response.json({
      message: `Resumen Abril sincronizado. Total Terapias: ${totalTerapias}`,
      totalTerapias: totalTerapias,
      pagosContados: pagosAbril.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});