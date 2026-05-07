-- =============================================================================
-- schema-v2.sql — Migración de Base44 a Supabase
--
-- Estrategia: text IDs (preservando los _id originales de Base44 para que los
-- CSVs se importen tal cual) y timestamps created_date/updated_date (matcheando
-- las columnas del export).
--
-- ORDEN: este script DROPea las 12 tablas de entidades y las recrea. La tabla
-- `profile` (vinculada a auth.users, sigue usando uuid) NO se toca.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor (como una sola transacción).
-- =============================================================================

-- ---------- DROP existing entity tables ----------
DROP TABLE IF EXISTS public.resumen_ingreso     CASCADE;
DROP TABLE IF EXISTS public.subarrendamiento    CASCADE;
DROP TABLE IF EXISTS public.gasto               CASCADE;
DROP TABLE IF EXISTS public.evento              CASCADE;
DROP TABLE IF EXISTS public.calendario_paciente CASCADE;
DROP TABLE IF EXISTS public.pago_terapia        CASCADE;
DROP TABLE IF EXISTS public.sesion_mensual      CASCADE;
DROP TABLE IF EXISTS public.horario_terapeuta   CASCADE;
DROP TABLE IF EXISTS public.nomina_mensual      CASCADE;
DROP TABLE IF EXISTS public.paciente            CASCADE;
DROP TABLE IF EXISTS public.empleado            CASCADE;
DROP TABLE IF EXISTS public.parametro           CASCADE;

-- ---------- Trigger genérico para mantener updated_date ----------
CREATE OR REPLACE FUNCTION public.set_updated_date()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_date = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. parametro
-- =============================================================================
CREATE TABLE public.parametro (
  id           text PRIMARY KEY,
  clave        text NOT NULL UNIQUE,
  valor        text NOT NULL,
  descripcion  text,
  tipo         text DEFAULT 'numero' CHECK (tipo IN ('numero','porcentaje','dinero','texto')),
  created_date timestamptz DEFAULT now(),
  updated_date timestamptz DEFAULT now()
);
CREATE TRIGGER trg_parametro_updated BEFORE UPDATE ON public.parametro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 2. empleado
-- =============================================================================
CREATE TABLE public.empleado (
  id                       text PRIMARY KEY,
  nombre                   text NOT NULL,
  iniciales                text,
  puesto                   text,
  sueldo_transferencia_mes numeric DEFAULT 0,
  sueldo_efectivo_mes      numeric DEFAULT 0,
  fecha_ingreso            date,
  estatus                  text DEFAULT 'Activo' CHECK (estatus IN ('Activo','Inactivo')),
  notas                    text,
  created_date             timestamptz DEFAULT now(),
  updated_date             timestamptz DEFAULT now()
);
CREATE TRIGGER trg_empleado_updated BEFORE UPDATE ON public.empleado
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 3. paciente
-- =============================================================================
CREATE TABLE public.paciente (
  id                     text PRIMARY KEY,
  nombre                 text NOT NULL,
  forma_pago_default     text DEFAULT 'Efectivo' CHECK (forma_pago_default IN ('Efectivo','Transferencia','Tarjeta','Depósito')),
  precio_sesion_regular  numeric DEFAULT 0,
  precio_sesion_matutina numeric DEFAULT 0,
  mes_inicio             integer,
  anio_inicio            integer,
  mes_alta               integer,
  anio_alta              integer,
  tipo_terapia           text,
  terapeutas             jsonb DEFAULT '{}'::jsonb,
  dias_sesion            jsonb DEFAULT '{}'::jsonb,
  tipo_sesion            jsonb DEFAULT '{}'::jsonb,
  estatus                text DEFAULT 'Activo' CHECK (estatus IN ('Activo','Inactivo','Pausado')),
  notas                  text,
  created_date           timestamptz DEFAULT now(),
  updated_date           timestamptz DEFAULT now()
);
CREATE TRIGGER trg_paciente_updated BEFORE UPDATE ON public.paciente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 4. nomina_mensual
-- =============================================================================
CREATE TABLE public.nomina_mensual (
  id                    text PRIMARY KEY,
  empleado_id           text REFERENCES public.empleado(id) ON DELETE SET NULL,
  empleado_nombre       text,
  anio                  integer NOT NULL,
  mes                   integer NOT NULL,
  sueldo_transferencia  numeric DEFAULT 0,
  sueldo_efectivo       numeric DEFAULT 0,
  aguinaldo             numeric DEFAULT 0,
  vacaciones            numeric DEFAULT 0,
  bono                  numeric DEFAULT 0,
  notas                 text,
  created_date          timestamptz DEFAULT now(),
  updated_date          timestamptz DEFAULT now()
);
CREATE TRIGGER trg_nomina_mensual_updated BEFORE UPDATE ON public.nomina_mensual
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 5. horario_terapeuta
-- =============================================================================
CREATE TABLE public.horario_terapeuta (
  id              text PRIMARY KEY,
  empleado_id     text REFERENCES public.empleado(id) ON DELETE SET NULL,
  empleado_nombre text,
  semana_inicio   date NOT NULL,
  slots           jsonb DEFAULT '{}'::jsonb,
  created_date    timestamptz DEFAULT now(),
  updated_date    timestamptz DEFAULT now()
);
CREATE TRIGGER trg_horario_terapeuta_updated BEFORE UPDATE ON public.horario_terapeuta
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 6. sesion_mensual
-- =============================================================================
CREATE TABLE public.sesion_mensual (
  id                 text PRIMARY KEY,
  paciente_id        text REFERENCES public.paciente(id) ON DELETE SET NULL,
  paciente_nombre    text,
  anio               integer NOT NULL,
  mes                integer NOT NULL,
  sesiones_matutinas numeric DEFAULT 0,
  sesiones_regulares numeric DEFAULT 0,
  beca_porcentaje    numeric DEFAULT 0,
  forma_pago_mes     text DEFAULT 'Efectivo',
  excepciones_dias   text,
  monto_override     numeric,
  notas              text,
  capturado_por      text,
  created_date       timestamptz DEFAULT now(),
  updated_date       timestamptz DEFAULT now()
);
CREATE TRIGGER trg_sesion_mensual_updated BEFORE UPDATE ON public.sesion_mensual
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 7. pago_terapia
-- =============================================================================
CREATE TABLE public.pago_terapia (
  id              text PRIMARY KEY,
  paciente_id     text REFERENCES public.paciente(id) ON DELETE SET NULL,
  paciente_nombre text,
  anio            integer NOT NULL,
  mes             integer NOT NULL,
  fecha_pago      date NOT NULL,
  dia_pago        integer,
  monto_pagado    numeric DEFAULT 0,
  sesiones_manual integer,
  forma_pago      text DEFAULT 'Efectivo',
  notas           text,
  capturado_por   text,
  created_date    timestamptz DEFAULT now(),
  updated_date    timestamptz DEFAULT now()
);
CREATE TRIGGER trg_pago_terapia_updated BEFORE UPDATE ON public.pago_terapia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 8. calendario_paciente
-- =============================================================================
CREATE TABLE public.calendario_paciente (
  id                  text PRIMARY KEY,
  paciente_id         text REFERENCES public.paciente(id) ON DELETE SET NULL,
  paciente_nombre     text,
  anio                integer NOT NULL,
  mes                 integer NOT NULL,
  horario             jsonb DEFAULT '{}'::jsonb,
  tipo_sesion         jsonb DEFAULT '{}'::jsonb,
  terapeutas          jsonb DEFAULT '{}'::jsonb,
  excepciones         text,
  reposiciones        jsonb DEFAULT '[]'::jsonb,
  total_sesiones      numeric DEFAULT 0,
  sesiones_regulares  numeric DEFAULT 0,
  sesiones_matutinas  numeric DEFAULT 0,
  reposiciones_count  numeric DEFAULT 0,
  monto_efectivo      numeric DEFAULT 0,
  monto_transferencia numeric DEFAULT 0,
  monto_override      numeric,
  notas               text,
  created_date        timestamptz DEFAULT now(),
  updated_date        timestamptz DEFAULT now()
);
CREATE TRIGGER trg_calendario_paciente_updated BEFORE UPDATE ON public.calendario_paciente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 9. evento
-- =============================================================================
CREATE TABLE public.evento (
  id              text PRIMARY KEY,
  fecha           date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN (
    'Cita inicial / ingreso','Cita seguimiento directora',
    'Cita escolar virtual','Cita escolar presencial',
    'Observación escolar','Reporte adicional','Evaluación'
  )),
  nombre_paciente text,
  forma_pago      text DEFAULT 'Efectivo',
  precio_base     numeric,
  fecha_pago      date,
  monto_pagado    numeric DEFAULT 0,
  notas           text,
  capturado_por   text,
  created_date    timestamptz DEFAULT now(),
  updated_date    timestamptz DEFAULT now()
);
CREATE TRIGGER trg_evento_updated BEFORE UPDATE ON public.evento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 10. gasto
-- =============================================================================
CREATE TABLE public.gasto (
  id            text PRIMARY KEY,
  fecha         date NOT NULL,
  categoria     text NOT NULL CHECK (categoria IN (
    'Renta','Materiales Centro','Materiales Limpieza','Comidas','Servicios',
    'Renta Terapeutas','Capacitaciones','Nómina','Impuestos','Otros'
  )),
  concepto      text NOT NULL,
  monto         numeric NOT NULL,
  con_factura   boolean DEFAULT false,
  forma_pago    text DEFAULT 'Efectivo',
  proveedor     text,
  notas         text,
  capturado_por text,
  created_date  timestamptz DEFAULT now(),
  updated_date  timestamptz DEFAULT now()
);
CREATE TRIGGER trg_gasto_updated BEFORE UPDATE ON public.gasto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 11. subarrendamiento
-- =============================================================================
CREATE TABLE public.subarrendamiento (
  id                 text PRIMARY KEY,
  inquilino          text NOT NULL,
  forma_pago         text DEFAULT 'Efectivo',
  renta_mensual_base numeric DEFAULT 0,
  anio               integer NOT NULL,
  mes                integer NOT NULL,
  monto_cobrado      numeric DEFAULT 0,
  notas              text,
  created_date       timestamptz DEFAULT now(),
  updated_date       timestamptz DEFAULT now()
);
CREATE TRIGGER trg_subarrendamiento_updated BEFORE UPDATE ON public.subarrendamiento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- 12. resumen_ingreso
-- =============================================================================
CREATE TABLE public.resumen_ingreso (
  id              text PRIMARY KEY,
  anio            integer NOT NULL,
  mes             integer NOT NULL,
  terapias        numeric DEFAULT 0,
  citas           numeric DEFAULT 0,
  evaluaciones    numeric DEFAULT 0,
  subarrendamiento numeric DEFAULT 0,
  otros           numeric DEFAULT 0,
  notas           text,
  created_date    timestamptz DEFAULT now(),
  updated_date    timestamptz DEFAULT now()
);
CREATE TRIGGER trg_resumen_ingreso_updated BEFORE UPDATE ON public.resumen_ingreso
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_date();

-- =============================================================================
-- ÍNDICES
-- =============================================================================
CREATE INDEX idx_sesion_mensual_pac_anio_mes      ON public.sesion_mensual      (paciente_id, anio, mes);
CREATE INDEX idx_pago_terapia_pac_anio_mes        ON public.pago_terapia        (paciente_id, anio, mes);
CREATE INDEX idx_calendario_paciente_pac_anio_mes ON public.calendario_paciente (paciente_id, anio, mes);
CREATE INDEX idx_nomina_mensual_emp_anio_mes      ON public.nomina_mensual      (empleado_id, anio, mes);
CREATE INDEX idx_gasto_fecha                      ON public.gasto               (fecha);
CREATE INDEX idx_evento_fecha                     ON public.evento              (fecha);
CREATE INDEX idx_horario_terapeuta_semana         ON public.horario_terapeuta   (semana_inicio);
CREATE INDEX idx_subarrendamiento_anio_mes        ON public.subarrendamiento    (anio, mes);
CREATE INDEX idx_resumen_ingreso_anio_mes         ON public.resumen_ingreso     (anio, mes);
CREATE INDEX idx_paciente_estatus_nombre          ON public.paciente            (estatus, nombre);
CREATE INDEX idx_empleado_estatus_nombre          ON public.empleado            (estatus, nombre);
CREATE INDEX idx_parametro_clave                  ON public.parametro           (clave);

-- =============================================================================
-- ROW LEVEL SECURITY (D13: authenticated full access; refinar en Fase 6.5)
-- =============================================================================
ALTER TABLE public.parametro           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empleado            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paciente            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomina_mensual      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_terapeuta   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesion_mensual      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pago_terapia        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendario_paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evento              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gasto               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subarrendamiento    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumen_ingreso     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'parametro','empleado','paciente','nomina_mensual','horario_terapeuta',
    'sesion_mensual','pago_terapia','calendario_paciente','evento','gasto',
    'subarrendamiento','resumen_ingreso'
  ])
  LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated_full_access" ON public.%I
         FOR ALL TO authenticated USING (true) WITH CHECK (true)', t
    );
  END LOOP;
END $$;
