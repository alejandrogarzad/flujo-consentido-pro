import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Datos correctos de Marzo 2026 (total: 416,195)
    const datosMarzo = [
      ["Adrian Quintana", 7700, "Efectivo"],
      ["Alan Leonardo", 8800, "Efectivo"],
      ["Alana Hdz Lagarda", 7700, "Efectivo"],
      ["Alejandro Assad", 3300, "Efectivo"],
      ["Alison Muñiz", 9900, "Efectivo"],
      ["Ana Sofia Lopez Pérez", 4400, "Efectivo"],
      ["Andres Gomez", 8800, "Efectivo"],
      ["Benjamin Rueda", 8800, "Efectivo"],
      ["Camila Garcia", 4400, "Transferencia"],
      ["Camila Soto", 8800, "Efectivo"],
      ["Carlos Valenzuela", 8800, "Efectivo"],
      ["Carola Martinez", 3300, "Efectivo"],
      ["Catalina Hinojosa", 8800, "Efectivo"],
      ["Cordelia Hinojosa", 8800, "Efectivo"],
      ["Daniela Gallegos", 8800, "Transferencia"],
      ["Diego Muñoz", 8800, "Efectivo"],
      ["Donato Saldivar Garza", 8470, "Transferencia"],
      ["Eduardo Hdz Bovio", 13200, "Efectivo"],
      ["Elias Ramos", 3600, "Efectivo"],
      ["Emilia Vazquez", 7700, "Efectivo"],
      ["Emiliano Torres", 3850, "Efectivo"],
      ["Emilio Buerba", 14300, "Transferencia"],
      ["Eugenia Arredondo", 7700, "Efectivo"],
      ["Eva Lozano", 4400, "Efectivo"],
      ["Federico Garza", 4000, "Efectivo"],
      ["Fernando Treviño", 12100, "Efectivo"],
      ["Gerardo Romero Quintanilla", 6600, "Efectivo"],
      ["Ian Cornish Ravizé", 4400, "Efectivo"],
      ["Jimena Mendivil Torres", 15400, "Transferencia"],
      ["Joaquin Nuñez", 7700, "Efectivo"],
      ["José Antonio Lobeira", 7700, "Efectivo"],
      ["Leonel Pineda", 7700, "Efectivo"],
      ["Lukey Immendorf", 7700, "Efectivo"],
      ["Macarena James", 8800, "Efectivo"],
      ["Marcelo Hermosillo", 12100, "Efectivo"],
      ["María Carlota Castillo", 8800, "Efectivo"],
      ["María Fernanda Vázquez", 8800, "Efectivo"],
      ["Maria José González", 7700, "Efectivo"],
      ["Mateo Gamez", 7700, "Efectivo"],
      ["Mathias Orozco", 7600, "Efectivo"],
      ["Maximo Garcia", 8800, "Efectivo"],
      ["Nathan Herrera Dávila", 4400, "Transferencia"],
      ["Oliver Alexander", 12100, "Transferencia"],
      ["Pato Rdz Hernandez", 6600, "Efectivo"],
      ["Pedro Gloria Kuljacha", 12100, "Transferencia"],
      ["Pedro Gonzalez", 3325, "Efectivo"],
      ["Regina Garza", 7700, "Efectivo"],
      ["Ricardo Estrada", 7700, "Efectivo"],
      ["Ricardo Martin", 8800, "Efectivo"],
      ["Santiago Espinoza", 5600, "Efectivo"],
      ["Santiago Lopez Siañez", 6300, "Efectivo"],
      ["Sebastian Cruz", 6050, "Efectivo"],
      ["Victor Tovar", 8800, "Efectivo"],
    ];

    // Obtener todos los pagos de Marzo
    const todosPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
    const pagosMarzo = todosPagos.filter(p => p.mes === 3 && (p.anio === 2026 || !p.anio));

    // Eliminar todos los pagos de Marzo
    if (pagosMarzo.length > 0) {
      await Promise.all(pagosMarzo.map(p => base44.entities.PagoTerapia.delete(p.id)));
    }

    // Obtener todos los pacientes para mapear nombres a IDs
    const pacientes = await base44.entities.Paciente.list("-created_date", 500);
    const pacienteMap = Object.fromEntries(pacientes.map(p => [p.nombre.toLowerCase().trim(), p]));

    // Crear nuevos registros limpios
    const creaciones = [];
    for (const [nombre, monto, forma] of datosMarzo) {
      const pac = pacienteMap[nombre.toLowerCase().trim()];
      if (pac) {
        creaciones.push(
          base44.entities.PagoTerapia.create({
            paciente_id: pac.id,
            paciente_nombre: pac.nombre,
            mes: 3,
            anio: 2026,
            fecha_pago: "2026-03-31",
            monto_pagado: monto,
            forma_pago: forma,
            recargo: false,
          })
        );
      }
    }

    if (creaciones.length > 0) {
      await Promise.all(creaciones);
    }

    // Actualizar resumen de ingresos
    const resumenes = await base44.entities.ResumenIngreso.filter({ anio: 2026, mes: 3 });
    const totalTerapias = datosMarzo.reduce((sum, [_, monto]) => sum + monto, 0);

    if (resumenes.length > 0) {
      await base44.entities.ResumenIngreso.update(resumenes[0].id, {
        terapias: totalTerapias,
      });
    } else {
      await base44.entities.ResumenIngreso.create({
        anio: 2026,
        mes: 3,
        terapias: totalTerapias,
        citas: 0,
        evaluaciones: 0,
        subarrendamiento: 0,
        otros: 0,
      });
    }

    return Response.json({
      message: `Marzo 2026 reseteado con datos correctos. Total: ${totalTerapias}`,
      eliminados: pagosMarzo.length,
      creados: creaciones.length,
      totalTerapias: totalTerapias
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});