// Exclusão de OUTRO usuário, disparada por um admin no painel
// (`/admin/config/operadores`). Antes a UI só apagava a linha de `profiles`:
// a conta em auth.users seguia com senha e JWT válidos. Apagar de auth.users
// exige a service_role key, que nunca chega ao navegador — por isso a function.
//
// Fluxo:
//   1. Descobre quem está chamando (JWT enviado pelo cliente)
//   2. Confirma que quem chama é admin (profiles.role) via service_role
//   3. Recusa auto-exclusão e exclusão do último admin (conta admins em
//      profiles; contas de auth sem profile não contam como admin)
//   4. auth.admin.deleteUser — o ON DELETE CASCADE apaga o profile. Conta sem
//      profile (órfã de exclusão antiga) também pode ser removida por aqui.
//
// Sessões já emitidas: o JWT do usuário apagado continua válido até expirar
// (exp). O GoTrue rejeita o refresh, mas várias policies de RLS só checam
// auth.role()/auth.uid() e não dependem de profiles; não há revogação imediata.
//
// Corrida do último admin: a checagem acima é só para dar mensagem clara. A
// garantia é o trigger profiles_admin_delete_guard (migration 20261123), que
// roda no cascade sob pg_advisory_xact_lock e recusa remover o último admin.
//
// CORS é tratado pelo Kong (plugin cors na rota functions-v1).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { checkDelete, isUuid, normalizeUuid } from './rules.ts';

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

  let body: { userId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  if (!isUuid(body.userId)) {
    return json({ error: 'userId é obrigatório e deve ser um UUID.' }, 400);
  }
  const userId = normalizeUuid(body.userId);

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
    return json({ error: 'Apenas administradores podem excluir um usuário.' }, 403);
  }

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (targetError) {
    return json({ error: `Falha ao consultar o usuário: ${targetError.message}` }, 500);
  }

  const { count, error: countError } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin');
  if (countError || count === null) {
    return json({ error: 'Falha ao contar administradores.' }, 500);
  }

  const decision = checkDelete({
    callerId: caller.id,
    targetId: userId,
    targetRole: target?.role ?? null,
    adminCount: count,
  });
  if (!decision.ok) {
    return json({ error: decision.error }, decision.status);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    // Conta inexistente em auth.users: nada a revogar. Se sobrou profile, limpa.
    if (deleteError.status === 404) {
      const { error: cleanupError } = await admin.from('profiles').delete().eq('id', userId);
      if (cleanupError) {
        // Last-admin guard (or any other refusal): the profile is still there.
        return json({ error: 'Não é possível excluir o último administrador.' }, 409);
      }
      return json({ success: true, alreadyGone: true });
    }
    // Perdeu a corrida pelo último admin (o trigger recusou o cascade)?
    if (target?.role === 'admin') {
      const { count: restantes } = await admin
        .from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if (restantes !== null && restantes <= 1) {
        return json({ error: 'Não é possível excluir o último administrador.' }, 409);
      }
    }
    return json({ error: `Falha ao excluir usuário: ${deleteError.message}` }, 500);
  }

  return json({ success: true });
});
