-- =============================================================================
-- migrate-precio-sesion-nullable.sql
--
-- Cambia la convención de paciente.precio_sesion_regular / matutina:
--
--   ANTES:
--     0     = "usar precio global"  (default 0)
--     >0    = precio específico
--     (no había forma de decir "este paciente paga $0 literal")
--
--   AHORA:
--     NULL  = "usar precio global"
--     0     = literal $0 (beca completa, no cobra)
--     >0    = precio específico
--
-- Migra los registros existentes con valor 0 (que significaban "usar global")
-- a NULL para preservar el comportamiento. Quita el DEFAULT 0.
--
-- IMPORTANTE: ejecutar en producción una sola vez. Idempotente (si ya está
-- migrado, no hace daño).
-- =============================================================================

UPDATE public.paciente
SET precio_sesion_regular = NULL
WHERE precio_sesion_regular = 0;

UPDATE public.paciente
SET precio_sesion_matutina = NULL
WHERE precio_sesion_matutina = 0;

ALTER TABLE public.paciente
  ALTER COLUMN precio_sesion_regular DROP DEFAULT;

ALTER TABLE public.paciente
  ALTER COLUMN precio_sesion_matutina DROP DEFAULT;

NOTIFY pgrst, 'reload schema';

-- Verificar después:
--   SELECT COUNT(*) FILTER (WHERE precio_sesion_regular IS NULL)  AS sin_precio,
--          COUNT(*) FILTER (WHERE precio_sesion_regular = 0)      AS literal_cero,
--          COUNT(*) FILTER (WHERE precio_sesion_regular > 0)      AS con_precio_personalizado
--   FROM public.paciente;
