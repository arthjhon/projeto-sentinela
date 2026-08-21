-- Fecha a escalada de privilegio via signup publico: handle_new_user() confiava
-- em raw_user_meta_data->>'role' vindo do proprio client, com fallback pra
-- 'admin' quando ausente. GOTRUE_DISABLE_SIGNUP=false deixa /auth/v1/signup
-- publico e sem confirmacao de e-mail — qualquer chamador anonimo vira admin
-- completo com uma unica chamada HTTP (com ou sem metadata explicito).
--
-- Dai em diante todo novo signup entra como 'visualizador', sem excecao.
-- Promocao de role passa a exigir a Edge Function admin-create-user, que so
-- roda depois de confirmar server-side (via service_role) que quem chama ja
-- e admin — mesmo padrao ja usado em admin-reset-password.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, name, username, role, must_change_password)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Admin Principal'),
    COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'admin'),
    -- Role NUNCA vem de metadata (client-controlled, inclusive num signup
    -- publico anonimo) — todo novo signup entra como visualizador. Promocao
    -- so acontece via admin-create-user, que faz um UPDATE explicito depois
    -- de ja ter confirmado que quem pediu e admin.
    'visualizador',
    CASE WHEN new.raw_user_meta_data->>'name' IS NULL THEN FALSE ELSE TRUE END
  );
  RETURN new;
END;
$function$;
