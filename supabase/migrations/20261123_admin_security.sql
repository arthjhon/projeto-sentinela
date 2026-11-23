-- Admin panel waves 0-1, Task 2 (security and operators).
-- Closes: C1 (REST delete of profiles without revoking auth), I8 (demo account reads
-- usernames and the audit log over REST), I9 (forgeable audit log), M2 (self role change /
-- last admin demotion).
--
-- Idempotent: safe to re-run. NOT applied automatically; apply by hand with the go of the
-- owner, after deploying nothing else is required (the Edge Function admin-delete-user is
-- independent; the UI change ships with the frontend deploy).
--
-- What it does
--   1. public.current_user_role(): SECURITY DEFINER helper (avoids RLS recursion on profiles).
--   2. audit_logs: SELECT only admin/operador; INSERT requires operador_id = auth.uid() and
--      role admin/operador; BEFORE INSERT trigger fills operador_nome from profiles.username
--      (whatever the client sends is overwritten).
--   3. profiles: SELECT only own row or admin (was: any authenticated, which exposed every
--      username to the demo account). Non-admins list operators through the RPC
--      public.operadores_lista() that returns id, name, role only.
--   4. profiles: drops the admin DELETE policy. Deleting an operator now goes through the
--      Edge Function admin-delete-user (auth.admin.deleteUser; cascade removes the profile).
--   5. profiles BEFORE UPDATE OF role trigger: a client session cannot change its own role nor
--      demote the last admin. SQL editor / service_role (auth.uid() IS NULL) are unaffected.
--
-- Assumption to confirm on the target DB before applying (read-only):
--   select policyname, cmd from pg_policies where tablename in ('profiles','audit_logs');
--   Any other permissive SELECT policy on these tables would keep the old exposure.
--
-- ROLLBACK (run manually to restore the previous behaviour):
--   DROP TRIGGER IF EXISTS profiles_role_guard ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_role_guard();
--   DROP TRIGGER IF EXISTS audit_logs_set_operador ON public.audit_logs;
--   DROP FUNCTION IF EXISTS public.audit_logs_set_operador();
--   DROP FUNCTION IF EXISTS public.operadores_lista();
--   DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
--   CREATE POLICY "Allow logged-in users to view profiles" ON public.profiles
--     FOR SELECT USING (auth.role() = 'authenticated');
--   CREATE POLICY "Admins_Delete_Profiles" ON public.profiles FOR DELETE USING (
--     EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
--   DROP POLICY IF EXISTS audit_select ON public.audit_logs;
--   CREATE POLICY audit_select ON public.audit_logs FOR SELECT USING (auth.role() = 'authenticated');
--   DROP POLICY IF EXISTS audit_insert ON public.audit_logs;
--   CREATE POLICY audit_insert ON public.audit_logs FOR INSERT WITH CHECK (
--     EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'operador')));
--   DROP FUNCTION IF EXISTS public.current_user_role();

BEGIN;

-- 1. Role of the caller, bypassing RLS on profiles (a policy on profiles that selects from
--    profiles would recurse).
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- 2. audit_logs
DROP POLICY IF EXISTS audit_select ON public.audit_logs;
CREATE POLICY audit_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin', 'operador'));

DROP POLICY IF EXISTS audit_insert ON public.audit_logs;
CREATE POLICY audit_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    operador_id = auth.uid()
    AND public.current_user_role() IN ('admin', 'operador')
  );

CREATE OR REPLACE FUNCTION public.audit_logs_set_operador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ignores the client-sent name. Runs before the NOT NULL check, so omitting the column
  -- from the INSERT is fine.
  SELECT username INTO NEW.operador_nome FROM public.profiles WHERE id = NEW.operador_id;
  IF NEW.operador_nome IS NULL THEN
    NEW.operador_nome := 'desconhecido';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_logs_set_operador() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_logs_set_operador ON public.audit_logs;
CREATE TRIGGER audit_logs_set_operador
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_set_operador();

-- 3. profiles: own row or admin. Everyone else gets names and roles from the RPC below.
DROP POLICY IF EXISTS "Allow logged-in users to view profiles" ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.operadores_lista()
RETURNS TABLE (id uuid, name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.role
  FROM public.profiles p
  WHERE public.current_user_role() IS NOT NULL
  ORDER BY p.created_at
$$;
REVOKE ALL ON FUNCTION public.operadores_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operadores_lista() TO authenticated;

-- 4. Deleting a profile directly would leave the auth account alive (C1). Only the Edge
--    Function (service_role) deletes now.
DROP POLICY IF EXISTS "Admins_Delete_Profiles" ON public.profiles;

-- 5. Role guard for client sessions.
CREATE OR REPLACE FUNCTION public.profiles_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode alterar o seu próprio nível de acesso.' USING ERRCODE = '42501';
  END IF;
  IF OLD.role = 'admin'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND id <> OLD.id) THEN
    RAISE EXCEPTION 'Não é possível rebaixar o último administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.profiles_role_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_role_guard ON public.profiles;
CREATE TRIGGER profiles_role_guard
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_role_guard();

COMMIT;
