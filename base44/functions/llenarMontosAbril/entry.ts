import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const montos = {
      "Adrian Quintana": 2200,
      "Alan Leonardo": 0,
      "Alana Hdz Lagarda": 8800,
      "Alejandro Assad": 4400,
      "Alison Muñiz": 10800,
      "Ana Sofia Lopez Pérez": 4400,
      "Andres Gomez": 6600,
      "Benjamin Rueda": 8800,
      "Camila Garcia": 0,
      "Camila Soto": 8800,
      "Carlos Valenzuela": 7700,
      "Carola Martinez": 4840,
      "Catalina Hinojosa": 7700,
      "Cordelia Hinojosa": 8800,
      "Daniela Gallegos": 8800,
      "Diego Muñoz": 8800,
      "Donato Saldivar Garza": 2200,
      "Eduardo Hdz Bovio": 12100,
      "Elias Ramos": 0,
      "Emilia Vazquez": 8800,
      "Emiliano Torres": 3850,
      "Emilio Buerba": 0,
      "Eugenia Arredondo": 8800,
      "Eva Lozano": 3300,
      "Federico Garza": 4000,
      "Fernando Treviño": 11000,
      "Gerardo Romero Quintanilla": 0,
      "Ian Cornish Ravizé": 0,
      "Jimena Mendivil Torres": 0,
      "Joaquin Nuñez": 6600,
      "José Antonio Lobeira": 8800,
      "Leonel Pineda": 8800,
      "Lukey Immendorf": 8800,
      "Macarena James": 0,
      "Marcelo Hermosillo": 12100,
      "María Carlota Castillo": 8800,
      "María Fernanda Vázquez": 7700,
      "Maria José González": 0,
      "Mateo Gamez": 8500,
      "Mathias Orozco": 8360,
      "Maximo Garcia": 8800,
      "Nathan Herrera Dávila": 4400,
      "Oliver Alexander": 0,
      "Pato Rdz Hernandez": 7700,
      "Pedro Gloria Kuljacha": 12100,
      "Pedro Gonzalez": 3800,
      "Regina Garza": 8800,
      "Ricardo Estrada": 7700,
      "Ricardo Martin": 4400,
      "Santiago Espinoza": 4900,
      "Santiago Lopez Siañez": 7200,
      "Sebastian Cruz": 6600,
      "Victor Tovar": 4400,
    };

    const todosPagos = await base44.entities.PagoTerapia.list("-created_date", 500);
    const pagosAbril = todosPagos.filter(p => p.mes === 4 && (p.anio === 2026 || !p.anio));

    const ops = [];
    for (const pago of pagosAbril) {
      const montoEsperado = montos[pago.paciente_nombre];
      if (montoEsperado !== undefined) {
        ops.push(
          base44.entities.PagoTerapia.update(pago.id, {
            monto_pagado: montoEsperado,
          })
        );
      }
    }

    if (ops.length > 0) {
      await Promise.all(ops);
    }

    return Response.json({
      message: `Se actualizaron ${ops.length} montos de Abril con los valores exactos.`,
      actualizados: ops.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});