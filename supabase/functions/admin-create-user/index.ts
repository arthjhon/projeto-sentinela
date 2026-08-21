// Criação de novo usuário do painel (`/admin/operadores`), disparada por um
// admin logado. Existe como Edge Function pela mesma razão do
// admin-reset-password: role de conta nova nunca pode ser decidido a partir
// de metadata que o próprio endpoint de signup aceita de qualquer chamador —
// authenticated ou não. Por isso GOTRUE_DISABLE_SIGNUP=true e toda criação de
// conta passa por aqui, nunca mais por supabase.auth.signUp() público.
//
// Fluxo:
//   1. Descobre quem está chamando (via o JWT que o cliente já manda)
//   2. Confirma que quem chama é admin (profiles.role) usando o client service_role
//   3. Cria a conta via auth.admin.createUser (nunca signUp público)
//   4. handle_new_user() já criou o profile como 'visualizador' (role nunca
//      vem de metadata); só agora, com o chamador já confirmado admin,
//      promovemos pro role pedido via UPDATE explícito.
//
// CORS é tratado pelo Kong (plugin cors na rota functions-v1), não precisa
// tratar aqui.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VALID_ROLES = ['admin', 'operador', 'visualizador'];

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

  let body: { name?: string; username?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const { name, username, password, role } = body;
  if (!name || typeof name !== 'string') {
    return json({ error: 'name é obrigatório.' }, 400);
  }
  if (!username || typeof username !== 'string') {
    return json({ error: 'username é obrigatório.' }, 400);
  }
  if (!password || password.length < 8) {
    return json({ error: 'A senha deve ter no mínimo 8 caracteres.' }, 400);
  }
  if (!role || !VALID_ROLES.includes(role)) {
    return json({ error: `role deve ser um de: ${VALID_ROLES.join(', ')}.` }, 400);
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
    return json({ error: 'Apenas administradores podem criar novos usuários.' }, 403);
  }

  const email = username.includes('@') ? username : `${username}@sentinela.app`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, username },
  });
  if (createError || !created?.user) {
    return json({ error: `Falha ao criar usuário: ${createError?.message ?? 'erro desconhecido'}` }, 500);
  }

  const { error: roleError } = await admin
    .from('profiles')
    .update({ role, must_change_password: true })
    .eq('id', created.user.id);
  if (roleError) {
    return json({ error: `Usuário criado mas falha ao definir role: ${roleError.message}` }, 500);
  }

  return json({ success: true, userId: created.user.id });
});
