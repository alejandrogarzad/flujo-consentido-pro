-- =============================================================================
-- drop-foreign-keys.sql — Elimina los 5 foreign keys que tienen registros
-- huérfanos en los CSVs de Base44, para permitir importar todo. Después de
-- limpiar manualmente, se puede re-aplicar restore-foreign-keys.sql.
--
-- Huérfanos detectados en CSVs:
--   horario_terapeuta.empleado_id:    1
--   nomina_mensual.empleado_id:       0  (no necesario, pero por consistencia)
--   sesion_mensual.paciente_id:      12
--   pago_terapia.paciente_id:         5
--   calendario_paciente.paciente_id:  0  (no necesario, pero por consistencia)
-- =============================================================================

ALTER TABLE public.horario_terapeuta   DROP CONSTRAINT IF EXISTS horario_terapeuta_empleado_id_fkey;
ALTER TABLE public.nomina_mensual      DROP CONSTRAINT IF EXISTS nomina_mensual_empleado_id_fkey;
ALTER TABLE public.sesion_mensual      DROP CONSTRAINT IF EXISTS sesion_mensual_paciente_id_fkey;
ALTER TABLE public.pago_terapia        DROP CONSTRAINT IF EXISTS pago_terapia_paciente_id_fkey;
ALTER TABLE public.calendario_paciente DROP CONSTRAINT IF EXISTS calendario_paciente_paciente_id_fkey;
