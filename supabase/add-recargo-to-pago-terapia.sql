-- =============================================================================
-- add-recargo-to-pago-terapia.sql
--
-- La columna pago_terapia.recargo (boolean) faltó en schema-v2.sql porque no
-- venía en el spec original. La app la usa para marcar el recargo del 10%
-- por pago tardío.
--
-- Ejecutar en Supabase SQL Editor.
-- =============================================================================

ALTER TABLE public.pago_terapia
  ADD COLUMN IF NOT EXISTS recargo boolean DEFAULT false;

-- Refresca el schema cache de Supabase (PostgREST) para que el error
-- "Could not find the 'recargo' column of 'pago_terapia' in the schema cache"
-- desaparezca inmediatamente.
NOTIFY pgrst, 'reload schema';
