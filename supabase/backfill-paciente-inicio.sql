-- =============================================================================
-- backfill-paciente-inicio.sql — Infiere mes_inicio y anio_inicio para cada
-- paciente buscando el (anio, mes) más antiguo donde aparece en cualquiera de:
--   - sesion_mensual
--   - calendario_paciente
--   - pago_terapia
--
-- Razón: el CSV de Base44 no exportó estos campos. La función
-- pacienteAplicaEnMes() los necesita para mostrar al paciente en Calendarios,
-- Cobranza, Terapias, CXC.
--
-- Pacientes sin actividad en ninguna de esas tres tablas quedan con NULL
-- (puedes capturarlos manualmente después en /pacientes).
-- =============================================================================

WITH actividad AS (
  SELECT paciente_id, anio, mes FROM public.sesion_mensual
    WHERE paciente_id IS NOT NULL AND anio IS NOT NULL AND mes IS NOT NULL
  UNION ALL
  SELECT paciente_id, anio, mes FROM public.calendario_paciente
    WHERE paciente_id IS NOT NULL AND anio IS NOT NULL AND mes IS NOT NULL
  UNION ALL
  SELECT paciente_id, anio, mes FROM public.pago_terapia
    WHERE paciente_id IS NOT NULL AND anio IS NOT NULL AND mes IS NOT NULL
),
primero_por_pac AS (
  SELECT
    paciente_id,
    MIN(anio * 100 + mes) AS anio_mes_min
  FROM actividad
  GROUP BY paciente_id
)
UPDATE public.paciente p
SET
  anio_inicio = (pp.anio_mes_min / 100)::integer,
  mes_inicio  = (pp.anio_mes_min % 100)::integer
FROM primero_por_pac pp
WHERE p.id = pp.paciente_id
  AND (p.anio_inicio IS NULL OR p.mes_inicio IS NULL);

-- Reporte
SELECT
  COUNT(*) FILTER (WHERE mes_inicio IS NOT NULL AND anio_inicio IS NOT NULL) AS con_inicio,
  COUNT(*) FILTER (WHERE mes_inicio IS NULL OR  anio_inicio IS NULL)         AS sin_inicio,
  COUNT(*) AS total
FROM public.paciente;
