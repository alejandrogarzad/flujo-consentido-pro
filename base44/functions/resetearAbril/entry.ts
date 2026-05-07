import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Datos correctos de Abril 2026 (total: 384,050)
    const datosAbril = [
      ["Adrian Quintana", 2200, "Efectivo"],
      ["Alana Hdz Lagarda", 8800, "Efectivo"],
      ["Alejandro Assad", 4400, "Efectivo"],
      ["Alison Muñiz", 10800, "Efectivo"],
      ["Ana Sofia Lopez Pérez", 4400, "Efectivo"],
      ["Andres Gomez", 6600, "Efectivo"],
      ["Benjamin Rueda", 8800, "Efectivo"],
      ["Camila Soto", 8800, "Efectivo"],
      ["Carlos Valenzuela", 7700, "Efectivo"],
      ["Carola Martinez", 4840, "Efectivo"],
      ["Catalina Hinojosa", 7700, "Efectivo"],
      ["Cordelia Hinojosa", 8800, "Efectivo"],
      ["Daniela Gallegos", 8800, "Transferencia"],
      ["David Marcos Cruz", 8800, "Efectivo"],
      ["Diego Muñoz", 8800, "Efectivo"],
      ["Diego Zuviri", 2200, "Transferencia"],
      ["Donato Saldivar Garza", 2200, "Transferencia"],
      ["Eduardo Hdz Bovio", 12100, "Efectivo"],
      ["Elias Marcelo", 3600, "Efectivo"],
      ["Emilia Vazquez", 8800, "Efectivo"],
      ["Emiliano Torres", 3850, "Efectivo"],
      ["Emilio Benavides", 4400, "Efectivo"],
      ["Eugenia Arredondo", 8800, "Efectivo"],
      ["Eugenio Gonzalez", 8500, "Efectivo"],
      ["Eva Lozano", 3300, "Transferencia"],
      ["Federico Garza", 4000, "Efectivo"],
      ["Fernando Treviño", 11000, "Efectivo"],
      ["Frida Olvera", 11000, "Efectivo"],
      ["James Anthony", 12100, "Efectivo"],
      ["Joaquin Nuñez", 6600, "Efectivo"],
      ["José Antonio Lobeira", 8800, "Efectivo"],
      ["Leonardo Rizzi", 5500, "Efectivo"],
      ["Leonel Pineda", 8800, "Efectivo"],
      ["Lukey Immendorf", 8800, "Transferencia"],
      ["Marcelo Hermosillo", 12100, "Efectivo"],
      ["María Carlota Castillo", 8800, "Efectivo"],
      ["María Fernanda Vázquez", 7700, "Efectivo"],
      ["Mateo Gamez", 8500, "Efectivo"],
      ["Mathias Orozco", 8360, "Efectivo"],
      ["Maximo Garcia", 8800, "Transferencia"],
      ["Nathan Herrera Dávila", 4400, "Transferencia"],
      ["Pato Rdz Hernandez", 7700, "Efectivo"],
      ["Pedro Gloria Kuljacha", 12100, "Efectivo"],
      ["Pedro Gonzalez", 3800, "Efectivo"],
      ["Regina Garza", 8800, "Efectivo"],
      ["Ricardo Estrada", 7700, "Efectivo"],
      ["Ricardo Martin", 4400, "Efectivo"],
      ["Rodrigo Berlanga", 13200, "Efectivo"],
      ["Santiago Espinoza", 4900, "Efectivo"],
      ["Santiago Lopez Siañez", 7200, "Efectivo"],
      ["Sebastian Cruz", 6600, "Efectivo"],
      ["Victor Tovar", 4400, "Efectivo"],
    ];

    // Obtener todos los pagos de Abril
    const todosPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
    const pagosAbril = todosPagos.filter(p => p.mes === 4 && (p.anio === 2026 || !p.anio));

    // Eliminar todos los pagos de Abril
    if (pagosAbril.length > 0) {
      await Promise.all(pagosAbril.map(p => base44.entities.PagoTerapia.delete(p.id)));
    }

    // Obtener todos los pacientes para mapear nombres a IDs
    const pacientes = await base44.entities.Paciente.list("-created_date", 500);
    const pacienteMap = Object.fromEntries(pacientes.map(p => [p.nombre.toLowerCase().trim(), p]));

    // Crear nuevos registros limpios
    const creaciones = [];
    for (const [nombre, monto, forma] of datosAbril) {
      const pac = pacienteMap[nombre.toLowerCase().trim()];
      if (pac) {
        creaciones.push(
          base44.entities.PagoTerapia.create({
            paciente_id: pac.id,
            paciente_nombre: pac.nombre,
            mes: 4,
            anio: 2026,
            fecha_pago: "2026-04-30",
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
    const resumenes = await base44.entities.ResumenIngreso.filter({ anio: 2026, mes: 4 });
    const totalTerapias = datosAbril.reduce((sum, [_, monto]) => sum + monto, 0);

    if (resumenes.length > 0) {
      await base44.entities.ResumenIngreso.update(resumenes[0].id, {
        terapias: totalTerapias,
      });
    } else {
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
      message: `Abril 2026 reseteado con datos correctos. Total: ${totalTerapias}`,
      eliminados: pagosAbril.length,
      creados: creaciones.length,
      totalTerapias: totalTerapias
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});