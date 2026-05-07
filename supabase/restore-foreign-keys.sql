-- =============================================================================
-- restore-foreign-keys.sql — Re-aplica los foreign keys una vez que los
-- registros huérfanos hayan sido limpiados manualmente.
--
-- Antes de correr esto, verifica que NO haya huérfanos:
--   SELECT 'horario_terapeuta', COUNT(*) FROM horario_terapeuta h
--     LEFT JOIN empleado e ON e.id = h.empleado_id
--     WHERE h.empleado_id IS NOT NULL AND e.id IS NULL
--   UNION ALL
--   SELECT 'sesion_mensual', COUNT(*) FROM sesion_mensual s
--     LEFT JOIN paciente p ON p.id = s.paciente_id
--     WHERE s.paciente_id IS NOT NULL AND p.id IS NULL
--   UNION ALL
--   SELECT 'pago_terapia', COUNT(*) FROM pago_terapia pt
--     LEFT JOIN paciente p ON p.id = pt.paciente_id
--     WHERE pt.paciente_id IS NOT NULL AND p.id IS NULL;
-- Todos deben dar 0 antes de continuar.
-- =============================================================================

ALTER TABLE public.horario_terapeuta
  ADD CONSTRAINT horario_terapeuta_empleado_id_fkey
  FOREIGN KEY (empleado_id) REFERENCES public.empleado(id) ON DELETE SET NULL;

ALTER TABLE public.nomina_mensual
  ADD CONSTRAINT nomina_mensual_empleado_id_fkey
  FOREIGN KEY (empleado_id) REFERENCES public.empleado(id) ON DELETE SET NULL;

ALTER TABLE public.sesion_mensual
  ADD CONSTRAINT sesion_mensual_paciente_id_fkey
  FOREIGN KEY (paciente_id) REFERENCES public.paciente(id) ON DELETE SET NULL;

ALTER TABLE public.pago_terapia
  ADD CONSTRAINT pago_terapia_paciente_id_fkey
  FOREIGN KEY (paciente_id) REFERENCES public.paciente(id) ON DELETE SET NULL;

ALTER TABLE public.calendario_paciente
  ADD CONSTRAINT calendario_paciente_paciente_id_fkey
  FOREIGN KEY (paciente_id) REFERENCES public.paciente(id) ON DELETE SET NULL;
