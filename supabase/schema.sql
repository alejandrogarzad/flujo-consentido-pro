-- =============================================================================
-- Flujo Consentido — Schema Postgres (Supabase)
-- Migración del schema Base44 a Postgres preservando 1:1 la semántica del
-- modelo original. Se cubren las 12 entidades + helpers compartidos.
--
-- Decisiones aplicadas:
--   - id uuid PRIMARY KEY DEFAULT gen_random_uuid() en todas las tablas
--   - created_at, updated_at timestamps (updated_at vía trigger)
--   - forma_pago como ENUM compartido (6 entidades lo usan)
--   - paciente_nombre / empleado_nombre denormalizados (D2: mantener)
--   - SesionMensual + CalendarioPaciente coexisten (D3: mantener ambos)
--   - inquilino como texto libre (D4)
--   - ResumenIngreso como tabla escrita manual (D5)
--   - UNIQUE INDEX (paciente_id, anio, mes) en CalendarioPaciente — reemplaza
--     la función `limpiarCalendariosDuplicados` de Base44
--   - RLS: authenticated full access en esta fase. Refinar en Fase 6.5.
-- =============================================================================

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Forma de pago compartida por: Paciente, PagoTerapia, SesionMensual, Evento,
-- Gasto, Subarrendamiento.
DO $$ BEGIN
  CREATE TYPE forma_pago_enum AS ENUM ('Efectivo', 'Transferencia', 'Tarjeta', 'Depósito');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estatus de paciente
DO $$ BEGIN
  CREATE TYPE estatus_paciente_enum AS ENUM ('Activo', 'Inactivo', 'Pausado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estatus de empleado
DO $$ BEGIN
  CREATE TYPE estatus_empleado_enum AS ENUM ('Activo', 'Inactivo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipo de evento (citas y evaluaciones)
DO $$ BEGIN
  CREATE TYPE tipo_evento_enum AS ENUM (
    'Cita inicial / ingreso',
    'Cita seguimiento directora',
    'Cita escolar virtual',
    'Cita escolar presencial',
    'Observación escolar',
    'Reporte adicional',
    'Evaluación'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Categoría de gasto
DO $$ BEGIN
  CREATE TYPE categoria_gasto_enum AS ENUM (
    'Renta',
    'Materiales Centro',
    'Materiales Limpieza',
    'Comidas',
    'Servicios',
    'Renta Terapeutas',
    'Capacitaciones',
    'Nómina',
    'Impuestos',
    'Otros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tipo de Parametro (numero, porcentaje, dinero, texto)
DO $$ BEGIN
  CREATE TYPE tipo_parametro_enum AS ENUM ('numero', 'porcentaje', 'dinero', 'texto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- HELPER: trigger para actualizar updated_at automáticamente
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TABLA: Paciente
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.paciente (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                  text NOT NULL,
  forma_pago_default      forma_pago_enum DEFAULT 'Efectivo',
  precio_sesion_regular   numeric(12, 2) DEFAULT 0,
  precio_sesion_matutina  numeric(12, 2) DEFAULT 0,
  mes_inicio              smallint CHECK (mes_inicio BETWEEN 1 AND 12),
  anio_inicio             smallint CHECK (anio_inicio >= 2000),
  mes_alta                smallint CHECK (mes_alta BETWEEN 1 AND 12),
  anio_alta               smallint CHECK (anio_alta >= 2000),
  tipo_terapia            text,
  -- jsonb con shape {lunes..domingo: string} — terapeuta asignado por día
  terapeutas              jsonb DEFAULT '{}'::jsonb,
  -- jsonb con shape {lunes..domingo: string} — hora "9:00", "10:30", etc.
  dias_sesion             jsonb DEFAULT '{}'::jsonb,
  -- jsonb con shape {lunes..domingo: 'Regular'|'Matutina'}
  tipo_sesion             jsonb DEFAULT '{}'::jsonb,
  estatus                 estatus_paciente_enum DEFAULT 'Activo',
  notas                   text,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paciente_estatus ON public.paciente (estatus);
CREATE INDEX IF NOT EXISTS idx_paciente_nombre ON public.paciente (nombre);
CREATE INDEX IF NOT EXISTS idx_paciente_inicio ON public.paciente (anio_inicio, mes_inicio);

DROP TRIGGER IF EXISTS trg_paciente_updated_at ON public.paciente;
CREATE TRIGGER trg_paciente_updated_at
  BEFORE UPDATE ON public.paciente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: Empleado
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.empleado (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                      text NOT NULL,
  iniciales                   text,
  puesto                      text,
  sueldo_transferencia_mes    numeric(12, 2) DEFAULT 0,
  sueldo_efectivo_mes         numeric(12, 2) DEFAULT 0,
  fecha_ingreso               date,
  estatus                     estatus_empleado_enum DEFAULT 'Activo',
  notas                       text,
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empleado_estatus ON public.empleado (estatus);
CREATE INDEX IF NOT EXISTS idx_empleado_nombre ON public.empleado (nombre);

DROP TRIGGER IF EXISTS trg_empleado_updated_at ON public.empleado;
CREATE TRIGGER trg_empleado_updated_at
  BEFORE UPDATE ON public.empleado
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: CalendarioPaciente
--   Plantilla mensual del horario de un paciente con sesiones y montos.
--   UNIQUE (paciente_id, anio, mes) reemplaza la función limpiarCalendariosDuplicados.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.calendario_paciente (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id           uuid NOT NULL REFERENCES public.paciente (id) ON DELETE CASCADE,
  paciente_nombre       text,                                      -- denormalizado (D2)
  anio                  smallint NOT NULL CHECK (anio >= 2000),
  mes                   smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- jsonb {lunes..domingo: hora}
  horario               jsonb DEFAULT '{}'::jsonb,
  -- jsonb {lunes..domingo: 'Regular'|'Matutina'}
  tipo_sesion           jsonb DEFAULT '{}'::jsonb,
  -- jsonb {lunes..domingo: nombreTerapeuta}
  terapeutas            jsonb DEFAULT '{}'::jsonb,
  -- CSV de días excepción del mes, ej: "1,3,17"
  excepciones           text,
  -- array de {dia: int, hora: string, tipoRep: 'Regular'|'Matutina'}
  reposiciones          jsonb DEFAULT '[]'::jsonb,
  total_sesiones        integer DEFAULT 0,
  sesiones_regulares    integer DEFAULT 0,
  sesiones_matutinas    integer DEFAULT 0,
  reposiciones_count    integer DEFAULT 0,
  monto_efectivo        numeric(12, 2) DEFAULT 0,
  monto_transferencia   numeric(12, 2) DEFAULT 0,
  -- NULL = sin override; 0 = override a cero (preservar nullability)
  monto_override        numeric(12, 2),
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_calendario_paciente_periodo UNIQUE (paciente_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_calendario_periodo ON public.calendario_paciente (anio, mes);
CREATE INDEX IF NOT EXISTS idx_calendario_paciente ON public.calendario_paciente (paciente_id);

DROP TRIGGER IF EXISTS trg_calendario_paciente_updated_at ON public.calendario_paciente;
CREATE TRIGGER trg_calendario_paciente_updated_at
  BEFORE UPDATE ON public.calendario_paciente
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: SesionMensual
--   Coexiste con CalendarioPaciente (D3). Es el conteo simplificado por mes.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.sesion_mensual (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id           uuid NOT NULL REFERENCES public.paciente (id) ON DELETE CASCADE,
  paciente_nombre       text,                                      -- denormalizado
  anio                  smallint NOT NULL CHECK (anio >= 2000),
  mes                   smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  sesiones_matutinas    integer DEFAULT 0,
  sesiones_regulares    integer DEFAULT 0,
  beca_porcentaje       numeric(5, 2) DEFAULT 0 CHECK (beca_porcentaje BETWEEN 0 AND 100),
  forma_pago_mes        forma_pago_enum DEFAULT 'Efectivo',
  excepciones_dias      text,                                      -- CSV
  -- NULL = sin override; 0 = override a cero
  monto_override        numeric(12, 2),
  notas                 text,
  capturado_por         text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sesion_mensual_periodo UNIQUE (paciente_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_sesion_mensual_periodo ON public.sesion_mensual (anio, mes);
CREATE INDEX IF NOT EXISTS idx_sesion_mensual_paciente ON public.sesion_mensual (paciente_id);

DROP TRIGGER IF EXISTS trg_sesion_mensual_updated_at ON public.sesion_mensual;
CREATE TRIGGER trg_sesion_mensual_updated_at
  BEFORE UPDATE ON public.sesion_mensual
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: PagoTerapia
--   Permite múltiples pagos por mes/paciente (no único).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pago_terapia (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id       uuid NOT NULL REFERENCES public.paciente (id) ON DELETE CASCADE,
  paciente_nombre   text,                                          -- denormalizado
  anio              smallint NOT NULL CHECK (anio >= 2000),
  mes               smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  fecha_pago        date NOT NULL,
  dia_pago          smallint CHECK (dia_pago BETWEEN 1 AND 31),
  monto_pagado      numeric(12, 2) NOT NULL DEFAULT 0,
  -- sesiones manuales si no hay calendario para ese mes
  sesiones_manual   integer,
  forma_pago        forma_pago_enum DEFAULT 'Efectivo',
  -- recargo: la app muestra "+10% si día > dia_tope_pago"; flag opcional persistido
  recargo           boolean DEFAULT false,
  notas             text,
  capturado_por     text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pago_terapia_paciente_periodo ON public.pago_terapia (paciente_id, anio, mes);
CREATE INDEX IF NOT EXISTS idx_pago_terapia_fecha ON public.pago_terapia (fecha_pago);
CREATE INDEX IF NOT EXISTS idx_pago_terapia_periodo ON public.pago_terapia (anio, mes);

DROP TRIGGER IF EXISTS trg_pago_terapia_updated_at ON public.pago_terapia;
CREATE TRIGGER trg_pago_terapia_updated_at
  BEFORE UPDATE ON public.pago_terapia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: Evento (citas y evaluaciones)
--   nombre_paciente es texto libre, NO FK formal (relación blanda).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.evento (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha             date NOT NULL,
  tipo              tipo_evento_enum NOT NULL,
  nombre_paciente   text NOT NULL,
  forma_pago        forma_pago_enum DEFAULT 'Efectivo',
  precio_base       numeric(12, 2),
  fecha_pago        date,
  monto_pagado      numeric(12, 2) DEFAULT 0,
  notas             text,
  capturado_por     text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evento_fecha ON public.evento (fecha);
CREATE INDEX IF NOT EXISTS idx_evento_tipo ON public.evento (tipo);
CREATE INDEX IF NOT EXISTS idx_evento_nombre ON public.evento (nombre_paciente);
CREATE INDEX IF NOT EXISTS idx_evento_fecha_pago ON public.evento (fecha_pago);

DROP TRIGGER IF EXISTS trg_evento_updated_at ON public.evento;
CREATE TRIGGER trg_evento_updated_at
  BEFORE UPDATE ON public.evento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: Gasto
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.gasto (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           date NOT NULL,
  categoria       categoria_gasto_enum NOT NULL,
  concepto        text NOT NULL,
  monto           numeric(12, 2) NOT NULL,
  con_factura     boolean DEFAULT false,
  forma_pago      forma_pago_enum DEFAULT 'Efectivo',
  proveedor       text,
  notas           text,
  capturado_por   text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gasto_fecha ON public.gasto (fecha);
CREATE INDEX IF NOT EXISTS idx_gasto_categoria ON public.gasto (categoria);
CREATE INDEX IF NOT EXISTS idx_gasto_fecha_categoria ON public.gasto (fecha, categoria);
CREATE INDEX IF NOT EXISTS idx_gasto_factura ON public.gasto (con_factura) WHERE con_factura;

DROP TRIGGER IF EXISTS trg_gasto_updated_at ON public.gasto;
CREATE TRIGGER trg_gasto_updated_at
  BEFORE UPDATE ON public.gasto
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: HorarioTerapeuta
--   slots jsonb con claves dinámicas como "lunes_0900": "Libre"/"Actividad|Paciente"
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.horario_terapeuta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id         uuid NOT NULL REFERENCES public.empleado (id) ON DELETE CASCADE,
  empleado_nombre     text,                                        -- denormalizado
  semana_inicio       date NOT NULL,
  slots               jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_horario_terapeuta_semana UNIQUE (empleado_id, semana_inicio)
);

CREATE INDEX IF NOT EXISTS idx_horario_terapeuta_semana ON public.horario_terapeuta (semana_inicio);

DROP TRIGGER IF EXISTS trg_horario_terapeuta_updated_at ON public.horario_terapeuta;
CREATE TRIGGER trg_horario_terapeuta_updated_at
  BEFORE UPDATE ON public.horario_terapeuta
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: NominaMensual
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.nomina_mensual (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id             uuid NOT NULL REFERENCES public.empleado (id) ON DELETE CASCADE,
  empleado_nombre         text,                                    -- denormalizado
  anio                    smallint NOT NULL CHECK (anio >= 2000),
  mes                     smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  sueldo_transferencia    numeric(12, 2) DEFAULT 0,
  sueldo_efectivo         numeric(12, 2) DEFAULT 0,
  aguinaldo               numeric(12, 2) DEFAULT 0,
  vacaciones              numeric(12, 2) DEFAULT 0,
  -- bono anual; convención: solo se captura en mes 12
  bono                    numeric(12, 2) DEFAULT 0,
  notas                   text,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_nomina_mensual_periodo UNIQUE (empleado_id, anio, mes)
);

CREATE INDEX IF NOT EXISTS idx_nomina_mensual_periodo ON public.nomina_mensual (anio, mes);

DROP TRIGGER IF EXISTS trg_nomina_mensual_updated_at ON public.nomina_mensual;
CREATE TRIGGER trg_nomina_mensual_updated_at
  BEFORE UPDATE ON public.nomina_mensual
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: Subarrendamiento
--   inquilino texto libre (D4); permite múltiples filas por inquilino/mes
--   (un mismo inquilino podría rentar varios espacios).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.subarrendamiento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino             text NOT NULL,
  forma_pago            forma_pago_enum DEFAULT 'Efectivo',
  renta_mensual_base    numeric(12, 2) DEFAULT 0,
  anio                  smallint NOT NULL CHECK (anio >= 2000),
  mes                   smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  monto_cobrado         numeric(12, 2) DEFAULT 0,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subarrendamiento_periodo ON public.subarrendamiento (anio, mes);
CREATE INDEX IF NOT EXISTS idx_subarrendamiento_inquilino ON public.subarrendamiento (inquilino, anio, mes);

DROP TRIGGER IF EXISTS trg_subarrendamiento_updated_at ON public.subarrendamiento;
CREATE TRIGGER trg_subarrendamiento_updated_at
  BEFORE UPDATE ON public.subarrendamiento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: ResumenIngreso
--   Tabla escrita manual (D5). Coexiste con cálculos derivados desde
--   PagoTerapia + Evento + Subarrendamiento; los campos `notas` y `otros`
--   se preservan editables por el usuario.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.resumen_ingreso (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio                smallint NOT NULL CHECK (anio >= 2000),
  mes                 smallint NOT NULL CHECK (mes BETWEEN 1 AND 12),
  terapias            numeric(12, 2) DEFAULT 0,
  citas               numeric(12, 2) DEFAULT 0,
  evaluaciones        numeric(12, 2) DEFAULT 0,
  subarrendamiento    numeric(12, 2) DEFAULT 0,
  otros               numeric(12, 2) DEFAULT 0,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_resumen_ingreso_periodo UNIQUE (anio, mes)
);

DROP TRIGGER IF EXISTS trg_resumen_ingreso_updated_at ON public.resumen_ingreso;
CREATE TRIGGER trg_resumen_ingreso_updated_at
  BEFORE UPDATE ON public.resumen_ingreso
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: Parametro (key-value store)
--   `valor` siempre se almacena como text; el cast lo hace la app según `tipo`.
--   Incluye la clave `anio_actual` (D6) que la UI lee para parametrizar el año.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.parametro (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave         text NOT NULL UNIQUE,
  valor         text NOT NULL,
  descripcion   text,
  tipo          tipo_parametro_enum DEFAULT 'numero',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_parametro_updated_at ON public.parametro;
CREATE TRIGGER trg_parametro_updated_at
  BEFORE UPDATE ON public.parametro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- TABLA: profile (perfil de usuario con rol custom)
--   Base44 tenía un objeto User con `role` custom. En Supabase Auth, los
--   roles custom van en una tabla separada vinculada por user_id (auth.users).
--   Roles soportados: admin, user, cap_terapias, cap_pagos, cap_gastos.
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE app_role_enum AS ENUM ('admin', 'user', 'cap_terapias', 'cap_pagos', 'cap_gastos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.profile (
  id            uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email         text NOT NULL,
  full_name     text,
  role          app_role_enum NOT NULL DEFAULT 'user',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_role ON public.profile (role);

DROP TRIGGER IF EXISTS trg_profile_updated_at ON public.profile;
CREATE TRIGGER trg_profile_updated_at
  BEFORE UPDATE ON public.profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-crear profile cuando se registra un nuevo usuario en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profile (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
--   Fase actual: "authenticated full access" en todas las tablas (D13).
--   Fase 6.5 refinará por rol antes de exponer la app a usuarios externos.
-- =============================================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.paciente              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empleado              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendario_paciente   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesion_mensual        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pago_terapia          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evento                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gasto                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_terapeuta     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomina_mensual        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subarrendamiento      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumen_ingreso       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parametro             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile               ENABLE ROW LEVEL SECURITY;

-- Macro DO para crear policies "authenticated full access" en bulk
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'paciente','empleado','calendario_paciente','sesion_mensual','pago_terapia',
    'evento','gasto','horario_terapeuta','nomina_mensual','subarrendamiento',
    'resumen_ingreso','parametro'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "authenticated_full_access" ON public.%I
         FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- profile: policies por usuario
DROP POLICY IF EXISTS "profile_select_own_or_admin" ON public.profile;
CREATE POLICY "profile_select_own_or_admin" ON public.profile
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profile p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "profile_update_own_or_admin" ON public.profile;
CREATE POLICY "profile_update_own_or_admin" ON public.profile
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profile p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "profile_admin_insert" ON public.profile;
CREATE POLICY "profile_admin_insert" ON public.profile
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- =============================================================================
-- FIN
-- =============================================================================
