-- ================================================
-- Fix de RLS em public.profiles — duas falhas relacionadas:
--
-- 1. Escalada de privilégio: a policy "Users can update their own profile"
--    só restringia QUAL linha (auth.uid() = id), nunca QUAIS colunas. Sem
--    WITH CHECK travando `role`, qualquer autenticado podia se promover a
--    admin via PATCH direto em /rest/v1/profiles. Confirmado via teste real
--    (REST) antes desta correção.
--
-- 2. Edição de operador silenciosamente quebrada: não existia nenhuma policy
--    de "admin atualiza outro perfil" — editAdminUser() sempre retornava
--    HTTP 200 com 0 linhas afetadas (RLS bloqueava, sem erro), e o app não
--    conferia isso, reportando "sucesso" para uma escrita que nunca aconteceu.
--
-- Cole e execute no SQL Editor do Supabase. Idempotente (DROP + CREATE).
-- ================================================

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_any_profile" ON public.profiles;

-- Cada um edita o próprio perfil, mas a própria `role` nunca muda por aqui.
CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Admin gerencia qualquer perfil, inclusive mudando a role de outros
-- (é o caminho legítimo de promover/rebaixar operadores).
CREATE POLICY "admins_update_any_profile" ON public.profiles
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
