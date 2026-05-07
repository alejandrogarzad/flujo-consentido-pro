# Migración Base44 → Supabase: Procedimiento

**Total: 1,781 registros en 12 CSVs.**

| # | Tabla | Registros | FK depende de |
|---|---|---|---|
| 1 | parametro | 38 | — |
| 2 | empleado | 11 | — |
| 3 | paciente | 121 | — |
| 4 | nomina_mensual | 119 | empleado |
| 5 | horario_terapeuta | 20 | empleado |
| 6 | sesion_mensual | 198 | paciente |
| 7 | pago_terapia | 210 | paciente |
| 8 | calendario_paciente | 948 | paciente |
| 9 | evento | 84 | — |
| 10 | gasto | 17 | — |
| 11 | subarrendamiento | 4 | — |
| 12 | resumen_ingreso | 11 | — |

## Paso 1 — Aplicar schema-v2.sql

1. Abre [Supabase Dashboard → SQL Editor](https://supabase.com/dashboard/project/qrozzfhhfjazqdrzlwdp/sql/new)
2. Copia y pega el contenido de `supabase/schema-v2.sql`
3. Click **Run**

Esto:
- DROPea las 12 tablas existentes (vacías excepto `parametro` con 21 seeds — se reemplazan)
- Recrea las 12 tablas con `id text` y `created_date`/`updated_date`
- Crea índices y RLS (`authenticated_full_access`)
- NO toca `profile` (auth)

## Paso 2 — Importar CSVs en orden estricto

Usa [Table Editor](https://supabase.com/dashboard/project/qrozzfhhfjazqdrzlwdp/editor) → selecciona cada tabla → **Insert → Import data from CSV**.

**El orden importa por las foreign keys:**

```
1. parametro              → Parametro_export.csv
2. empleado               → Empleado_export.csv
3. paciente               → Paciente_export.csv
4. nomina_mensual         → NominaMensual_export.csv
5. horario_terapeuta      → HorarioTerapeuta_export.csv
6. sesion_mensual         → SesionMensual_export.csv
7. pago_terapia           → PagoTerapia_export.csv
8. calendario_paciente    → CalendarioPaciente_export.csv
9. evento                 → Evento_export.csv
10. gasto                 → Gasto_export.csv
11. subarrendamiento      → Subarrendamiento_export.csv
12. resumen_ingreso       → ResumenIngreso_export.csv
```

**Tips para Table Editor:**

- Las columnas `created_by_id`, `created_by`, `is_sample` que vienen en el CSV de Base44 NO existen en el schema → al importar, déjalas **unchecked** (Supabase muestra un mapping; desactiva esas tres).
- La columna `tipo` en `parametro` tiene CHECK constraint (`numero|porcentaje|dinero|texto`). Si algún registro CSV viene con valor distinto, abre el CSV y normalízalo antes.
- Para los CSVs grandes (CalendarioPaciente: 948 filas), Table Editor maneja sin problema; si truena, usa `psql` o el CLI de Supabase.

## Paso 3 — Verificar conteos

En SQL Editor, corre:

```sql
SELECT 'parametro' AS tabla, COUNT(*) FROM parametro
UNION ALL SELECT 'empleado', COUNT(*) FROM empleado
UNION ALL SELECT 'paciente', COUNT(*) FROM paciente
UNION ALL SELECT 'nomina_mensual', COUNT(*) FROM nomina_mensual
UNION ALL SELECT 'horario_terapeuta', COUNT(*) FROM horario_terapeuta
UNION ALL SELECT 'sesion_mensual', COUNT(*) FROM sesion_mensual
UNION ALL SELECT 'pago_terapia', COUNT(*) FROM pago_terapia
UNION ALL SELECT 'calendario_paciente', COUNT(*) FROM calendario_paciente
UNION ALL SELECT 'evento', COUNT(*) FROM evento
UNION ALL SELECT 'gasto', COUNT(*) FROM gasto
UNION ALL SELECT 'subarrendamiento', COUNT(*) FROM subarrendamiento
UNION ALL SELECT 'resumen_ingreso', COUNT(*) FROM resumen_ingreso
ORDER BY tabla;
```

Esperado: los conteos de la tabla de arriba.

## Paso 4 — Reiniciar dev server de next-app

El código ya fue actualizado para usar `created_date` en lugar de `created_at`. Solo:

```
cd next-app
npm run dev
```

Y refresca el browser. Las páginas ahora deberían mostrar datos reales.

## Cosas que pueden fallar (y cómo arreglar)

- **FK violation** durante import (`paciente_id` referencia un paciente que no existe): respeta el orden de la lista. Si un huérfano persiste, la columna `paciente_id` se queda `NULL` (FK con `ON DELETE SET NULL`), no bloquea el import.
- **CHECK constraint violation** (`tipo`, `categoria`, `forma_pago`): mira el mensaje de error, abre el CSV y normaliza el valor.
- **JSON malformado** en `terapeutas`/`dias_sesion`/`slots`/`reposiciones`: el CSV de Base44 puede traer JSON con escape raro. Si truena, abre el row específico en un editor y corrige; o importa el CSV en una tabla staging `text` y haz `INSERT INTO ... SELECT ... ::jsonb` con manejo de errores.
- **Sample data residual** en `parametro` (21 seeds del schema viejo): el `DROP TABLE` los borra. No hay overlap.
