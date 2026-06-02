-- =============================================================================
-- migrate-add-contador-role.sql
--
-- Agrega el rol "contador" al enum app_role_enum, para usuarios que solo
-- necesitan ver la pestaña "Para el Contador" (declaración mensual de IVA
-- e ISR) sin acceso al resto de la app.
--
-- INSTRUCCIONES:
-- 1. Abrir Supabase Dashboard → SQL Editor.
-- 2. Pegar y ejecutar este archivo COMPLETO.
-- 3. Verificar al final que el rol se agregó (la última SELECT lo lista).
-- 4. Entrar a /usuarios en la app e invitar al contador con rol "Contador".
--
-- SAFE: ADD VALUE es idempotente con IF NOT EXISTS — corre dos veces sin
-- error. No toca filas existentes.
-- =============================================================================

-- 1) Agregar el nuevo valor al enum (idempotente).
ALTER TYPE app_role_enum ADD VALUE IF NOT EXISTS 'contador';

-- 2) Verificar que quedó.
SELECT unnest(enum_range(NULL::app_role_enum)) AS roles_disponibles;
