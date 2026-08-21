-- Fecha uma lacuna de sequestro de identidade: a policy de auto-atualização
-- de profiles so travava o campo role, deixando name e username livres pra
-- qualquer usuario autenticado reescrever os proprios. Numa conta
-- compartilhada (ex: a conta demo, role visualizador) isso significa que
-- qualquer pessoa com a credencial pode renomear a identidade que todo
-- mundo ve na lista de Operadores. must_change_password fica de fora do
-- WITH CHECK de proposito — o fluxo de troca de senha no primeiro login
-- depende de poder mudar essa coluna livremente na propria linha.

DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;

CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND name = (SELECT p.name FROM public.profiles p WHERE p.id = auth.uid())
    AND username = (SELECT p.username FROM public.profiles p WHERE p.id = auth.uid())
  );
