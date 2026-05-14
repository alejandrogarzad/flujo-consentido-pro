-- =============================================================================
-- fix-profile-rls-recursion.sql
--
-- El schema original puso policies sobre `profile` que consultan a la misma
-- tabla `profile` desde dentro del USING/CHECK:
--     OR EXISTS (SELECT 1 FROM profile WHERE id = auth.uid() AND role = 'admin')
-- Eso causa "infinite recursion detected in policy for relation profile"
-- y ningún usuario puede leer su propio profile (todos ven role='user'
-- como fallback en el cliente).
--
-- Fix: reemplazar las policies recursivas por unas simples basadas solo en
-- `id = auth.uid()`. Para operaciones de admin sobre profile (asignar roles,
-- invitar) usamos el service role key desde server/scripts, que bypasea RLS.
-- =============================================================================

ALTER TABLE public.profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_select_own_or_admin" ON public.profile;
DROP POLICY IF EXISTS "profile_update_own_or_admin" ON public.profile;
DROP POLICY IF EXISTS "profile_admin_insert"        ON public.profile;
DROP POLICY IF EXISTS "profile_select_own"          ON public.profile;
DROP POLICY IF EXISTS "profile_update_own"          ON public.profile;

CREATE POLICY "profile_select_own" ON public.profile
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Usuarios pueden actualizar su propio profile (full_name, etc.) PERO no
-- cambiar su role (a nivel UI no se expone; a nivel SQL un usuario
-- malicioso podría — se mitiga en Fase 6.5 con trigger que prohíbe cambios
-- de role salvo via service role).
CREATE POLICY "profile_update_own" ON public.profile
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Inserts solo via service role (no necesita policy para authenticated).

NOTIFY pgrst, 'reload schema';
