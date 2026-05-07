import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const datosAbril = {
      "Adrian Quintana": [2200, "Efectivo"],
      "Alan Leonardo": [0, "Efectivo"],
      "Alana Hdz Lagarda": [8800, "Efectivo"],
      "Alejandro Assad": [4400, "Efectivo"],
      "Alison Muñiz": [10800, "Efectivo"],
      "Ana Sofia Lopez Pérez": [4400, "Efectivo"],
      "Andres Gomez": [6600, "Efectivo"],
      "Benjamin Rueda": [8800, "Efectivo"],
      "Camila Garcia": [0, "Transferencia"],
      "Camila Soto": [8800, "Efectivo"],
      "Carlos Valenzuela": [7700, "Efectivo"],
      "Carola Martinez": [4840, "Efectivo"],
      "Catalina Hinojosa": [7700, "Efectivo"],
      "Cordelia Hinojosa": [8800, "Efectivo"],
      "Daniela Gallegos": [8800, "Transferencia"],
      "Diego Muñoz": [8800, "Efectivo"],
      "Donato Saldivar Garza": [2200, "Transferencia"],
      "Eduardo Hdz Bovio": [12100, "Efectivo"],
      "Elias Ramos": [0, "Efectivo"],
      "Emilia Vazquez": [8800, "Efectivo"],
      "Emiliano Torres": [3850, "Efectivo"],
      "Emilio Buerba": [0, "Transferencia"],
      "Eugenia Arredondo": [8800, "Efectivo"],
      "Eva Lozano": [3300, "Transferencia"],
      "Federico Garza": [4000, "Efectivo"],
      "Fernando Treviño": [11000, "Efectivo"],
      "Gerardo Romero Quintanilla": [0, "Efectivo"],
      "Ian Cornish Ravizé": [0, "Efectivo"],
      "Jimena Mendivil Torres": [0, "Transferencia"],
      "Joaquin Nuñez": [6600, "Efectivo"],
      "José Antonio Lobeira": [8800, "Efectivo"],
      "Leonel Pineda": [8800, "Efectivo"],
      "Lukey Immendorf": [8800, "Transferencia"],
      "Macarena James": [0, "Efectivo"],
      "Marcelo Hermosillo": [12100, "Efectivo"],
      "María Carlota Castillo": [8800, "Efectivo"],
      "María Fernanda Vázquez": [7700, "Efectivo"],
      "Maria José González": [0, "Efectivo"],
      "Mateo Gamez": [8500, "Efectivo"],
      "Mathias Orozco": [8360, "Efectivo"],
      "Maximo Garcia": [8800, "Transferencia"],
      "Nathan Herrera Dávila": [4400, "Transferencia"],
      "Oliver Alexander": [0, "Transferencia"],
      "Pato Rdz Hernandez": [7700, "Efectivo"],
      "Pedro Gloria Kuljacha": [12100, "Efectivo"],
      "Pedro Gonzalez": [3800, "Efectivo"],
      "Regina Garza": [8800, "Efectivo"],
      "Ricardo Estrada": [7700, "Efectivo"],
      "Ricardo Martin": [4400, "Efectivo"],
      "Santiago Espinoza": [4900, "Efectivo"],
      "Santiago Lopez Siañez": [7200, "Efectivo"],
      "Sebastian Cruz": [6600, "Efectivo"],
      "Victor Tovar": [4400, "Efectivo"],
    };

    // Obtener todos los pagos de Abril
    const todosPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
    const pagosAbril = todosPagos.filter(p => p.mes === 4 && (p.anio === 2026 || !p.anio));

    // Obtener todos los pacientes
    const pacientes = await base44.entities.Paciente.list("-created_date", 500);
    const pacienteMap = Object.fromEntries(pacientes.map(p => [p.nombre.toLowerCase().trim(), p]));

    // Agrupar pagos por paciente
    const pagosPorPaciente = {};
    pagosAbril.forEach(p => {
      if (!pagosPorPaciente[p.paciente_nombre]) {
        pagosPorPaciente[p.paciente_nombre] = [];
      }
      pagosPorPaciente[p.paciente_nombre].push(p);
    });

    // Revisar cada paciente en la lista esperada
    const faltantes = [];
    const actualizaciones = [];
    
    for (const [nombre, [monto, forma]] of Object.entries(datosAbril)) {
      const paciente = pacienteMap[nombre.toLowerCase().trim()];
      const pagosExistentes = pagosPorPaciente[nombre];

      if (!pagosExistentes || pagosExistentes.length === 0) {
        // No existe pago, crear
        if (paciente && monto > 0) {
          faltantes.push({ nombre, monto, forma, paciente_id: paciente.id });
        }
      } else if (pagosExistentes.length === 1) {
        // Existe un pago, verificar monto y forma
        const pago = pagosExistentes[0];
        if (pago.monto_pagado !== monto || pago.forma_pago !== forma) {
          actualizaciones.push({
            id: pago.id,
            monto,
            forma,
            nombre
          });
        }
      } else {
        // Múltiples pagos, eliminar extras
        for (let i = 1; i < pagosExistentes.length; i++) {
          actualizaciones.push({
            id: pagosExistentes[i].id,
            delete: true,
            nombre
          });
        }
        // Actualizar el primero
        if (pagosExistentes[0].monto_pagado !== monto || pagosExistentes[0].forma_pago !== forma) {
          actualizaciones.push({
            id: pagosExistentes[0].id,
            monto,
            forma,
            nombre
          });
        }
      }
    }

    // Ejecutar creaciones
    const createOps = faltantes.map(f =>
      base44.entities.PagoTerapia.create({
        paciente_id: f.paciente_id,
        paciente_nombre: f.nombre,
        mes: 4,
        anio: 2026,
        fecha_pago: "2026-04-30",
        monto_pagado: f.monto,
        forma_pago: f.forma,
      })
    );

    // Ejecutar actualizaciones
    const updateOps = actualizaciones
      .filter(a => !a.delete)
      .map(a =>
        base44.entities.PagoTerapia.update(a.id, {
          monto_pagado: a.monto,
          forma_pago: a.forma,
        })
      );

    // Ejecutar eliminaciones
    const deleteOps = actualizaciones
      .filter(a => a.delete)
      .map(a => base44.entities.PagoTerapia.delete(a.id));

    await Promise.all([...createOps, ...updateOps, ...deleteOps]);

    // Recalcular total
    const pagosFinales = await base44.entities.PagoTerapia.list("-created_date", 500);
    const pagosAbrilFinal = pagosFinales.filter(p => p.mes === 4 && (p.anio === 2026 || !p.anio));
    const totalFinal = pagosAbrilFinal.reduce((sum, p) => sum + Number(p.monto_pagado || 0), 0);

    return Response.json({
      message: `Verificación completada. Creados: ${createOps.length}, Actualizados: ${updateOps.length}, Eliminados: ${deleteOps.length}. Total final: ${totalFinal}`,
      creados: createOps.length,
      actualizados: updateOps.length,
      eliminados: deleteOps.length,
      totalFinal: totalFinal
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});