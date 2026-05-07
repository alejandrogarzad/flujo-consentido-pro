-- =============================================================================
-- add-id-defaults.sql — Auto-generación de IDs para nuevas filas
--
-- En schema-v2.sql, las 12 tablas usan `id text PRIMARY KEY` sin DEFAULT,
-- porque al importar de Base44 los IDs venían en el CSV. Pero la app, al
-- insertar registros nuevos (ej. nuevo pago en Cobranza), no genera IDs:
-- esperaba que Postgres lo hiciera. Resultado: error NOT NULL en `id`.
--
-- Fix: agregar DEFAULT gen_random_uuid()::text. Las filas existentes con IDs
-- de Base44 (formato hex 24 chars) NO se tocan; solo afecta inserts nuevos.
--
-- gen_random_uuid() es built-in en Postgres 13+ (Supabase usa 15+).
-- =============================================================================

ALTER TABLE public.parametro           ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.empleado            ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.paciente            ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.nomina_mensual      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.horario_terapeuta   ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.sesion_mensual      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.pago_terapia        ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.calendario_paciente ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.evento              ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.gasto               ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.subarrendamiento    ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.resumen_ingreso     ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Refresca el schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
