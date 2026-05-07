-- =============================================================================
-- relax-constraints.sql — Hace nullable todos los NOT NULL (excepto PKs) y
-- elimina los CHECK constraints en columnas tipo enum, para permitir importar
-- datos históricos "sucios" tal cual. El usuario los limpiará a mano después.
--
-- Ejecutar en Supabase SQL Editor ANTES de importar los CSVs restantes.
-- =============================================================================

-- ---------- Drop NOT NULL en columnas que NO son PK ----------
-- empleado
ALTER TABLE public.empleado            ALTER COLUMN nombre        DROP NOT NULL;

-- paciente
ALTER TABLE public.paciente            ALTER COLUMN nombre        DROP NOT NULL;

-- nomina_mensual
ALTER TABLE public.nomina_mensual      ALTER COLUMN anio          DROP NOT NULL;
ALTER TABLE public.nomina_mensual      ALTER COLUMN mes           DROP NOT NULL;

-- horario_terapeuta
ALTER TABLE public.horario_terapeuta   ALTER COLUMN semana_inicio DROP NOT NULL;

-- sesion_mensual
ALTER TABLE public.sesion_mensual      ALTER COLUMN anio          DROP NOT NULL;
ALTER TABLE public.sesion_mensual      ALTER COLUMN mes           DROP NOT NULL;

-- pago_terapia
ALTER TABLE public.pago_terapia        ALTER COLUMN anio          DROP NOT NULL;
ALTER TABLE public.pago_terapia        ALTER COLUMN mes           DROP NOT NULL;
ALTER TABLE public.pago_terapia        ALTER COLUMN fecha_pago    DROP NOT NULL;

-- calendario_paciente
ALTER TABLE public.calendario_paciente ALTER COLUMN anio          DROP NOT NULL;
ALTER TABLE public.calendario_paciente ALTER COLUMN mes           DROP NOT NULL;

-- evento
ALTER TABLE public.evento              ALTER COLUMN fecha         DROP NOT NULL;
ALTER TABLE public.evento              ALTER COLUMN tipo          DROP NOT NULL;

-- gasto
ALTER TABLE public.gasto               ALTER COLUMN fecha         DROP NOT NULL;
ALTER TABLE public.gasto               ALTER COLUMN categoria     DROP NOT NULL;
ALTER TABLE public.gasto               ALTER COLUMN concepto      DROP NOT NULL;
ALTER TABLE public.gasto               ALTER COLUMN monto         DROP NOT NULL;

-- subarrendamiento
ALTER TABLE public.subarrendamiento    ALTER COLUMN inquilino     DROP NOT NULL;
ALTER TABLE public.subarrendamiento    ALTER COLUMN anio          DROP NOT NULL;
ALTER TABLE public.subarrendamiento    ALTER COLUMN mes           DROP NOT NULL;

-- resumen_ingreso
ALTER TABLE public.resumen_ingreso     ALTER COLUMN anio          DROP NOT NULL;
ALTER TABLE public.resumen_ingreso     ALTER COLUMN mes           DROP NOT NULL;

-- parametro (ya importada, pero por consistencia)
ALTER TABLE public.parametro           ALTER COLUMN clave         DROP NOT NULL;
ALTER TABLE public.parametro           ALTER COLUMN valor         DROP NOT NULL;

-- ---------- Drop CHECK constraints en columnas tipo enum ----------
-- (Los nombres son auto-generados por Postgres. Este DO block los encuentra
--  y dropea todos los CHECK constraints de las 12 tablas.)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid::regclass::text IN (
        'parametro','empleado','paciente','nomina_mensual','horario_terapeuta',
        'sesion_mensual','pago_terapia','calendario_paciente','evento','gasto',
        'subarrendamiento','resumen_ingreso'
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    RAISE NOTICE 'Dropped CHECK constraint % on %', r.conname, r.tbl;
  END LOOP;
END $$;
