// Reset de senha de OUTRO usuário, disparado por um admin no painel
// (`/admin/operadores`). Existe como Edge Function porque essa é a única forma
// seguirsa de fazer isso: a API Admin do GoTrue exige a service_role key, que
// nunca pode chegar ao bundle do navegador (app não tem backend próprio —
// service_role bypassa RLS inteiro). Aqui ela fica só nas env vars da function.
//
// Fluxo:
//   1. Descobre quem está chamando (via o JWT que o cliente já manda)
//   2. Confirma que quem chama é admin (profiles.role) usando o client service_role
//   3. Só então troca a senha via auth.admin.updateUserById
//   4. Marca must_change_password=true no profile do usuário alvo
//
// CORS é tratado pelo Kong (plugin cors na rota functions-v1), não precisa
// tratar aqui.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Não autenticado.' }, 401);
  }

  let body: { userId?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const { userId, newPassword } = body;
  if (!userId || typeof userId !== 'string') {
    return json({ error: 'userId é obrigatório.' }, 400);
  }
  if (!newPassword || newPassword.length < 8) {
    return json({ error: 'A nova senha deve ter no mínimo 8 caracteres.' }, 400);
  }

  // Client com a sessão de quem chamou — só pra identificar o chamador.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) {
    return json({ error: 'Sessão inválida.' }, 401);
  }

  // service_role só é usado depois de identificar quem chamou.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin') {
    return json({ error: 'Apenas administradores podem resetar senha de outro usuário.' }, 403);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updateError) {
    return json({ error: `Falha ao atualizar senha: ${updateError.message}` }, 500);
  }

  const { error: flagError } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', userId);
  if (flagError) {
    // Senha já foi trocada; loga no servidor mas não falha a operação por isso.
    console.error('admin-reset-password: falha ao marcar must_change_password:', flagError.message);
  }

  return json({ success: true });
});
