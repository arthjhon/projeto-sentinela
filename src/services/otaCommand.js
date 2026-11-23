// OTA commands are issued by the `ota-command` Edge Function (admin JWT); the
// browser has no MQTT credentials and cannot publish. See
// supabase/functions/ota-command/index.ts for the contract.

const MESSAGES = {
  not_pending: 'O deploy não está pendente (já foi enviado ou encerrado).',
  no_device: 'A bóia selecionada não possui dispositivo associado.',
  bad_device: 'O identificador do dispositivo da bóia é inválido.',
  bad_path: 'O caminho do arquivo de firmware é inválido.',
  bad_sha: 'O SHA-256 do firmware está ausente ou inválido.',
  no_version: 'A versão do firmware não foi informada.',
  too_large: 'Versão ou nome do arquivo longos demais para o comando OTA (máx. 512 bytes).',
  broker_unavailable: 'O broker MQTT está indisponível — comando não enviado.',
  deploy_not_found: 'Deploy não encontrado no histórico.',
  forbidden: 'Apenas administradores podem enviar comandos OTA.',
  unauthenticated: 'Sessão ausente — entre novamente.',
  invalid_session: 'Sessão inválida ou expirada — entre novamente.',
};

export function otaErrorMessage(code) {
  return MESSAGES[code] ?? `Falha ao enviar o comando OTA (${code}).`;
}

/** Row inserted in firmware_deploys; arquivo_path is the object path in bucket `firmware`. */
export function buildDeployRow({ boiaId, version, sha256, notes, path, operatorId, operatorName }) {
  return {
    boia_id: boiaId,
    versao: version,
    sha256,
    notas_release: notes || null,
    status: 'pendente',
    arquivo_path: path,
    ...(operatorId ? { operador_id: operatorId } : {}),
    ...(operatorName ? { operador_nome: operatorName } : {}),
  };
}

/**
 * Asks the Edge Function to publish the OTA command for a pending deploy.
 * On failure the deploy is marked `falha` here, except on 502, where the
 * function already did. Never throws.
 *
 * Trade-off: a network error (no HTTP status: request lost, timeout, tab
 * offline) is also marked `falha`, although the function may have run and
 * published the command, and the device may still update. Accepted: the
 * history row is never rewritten afterwards (the page stops tracking the
 * deploy on error), but the device's retained ota/status and the firmware
 * version in the fleet cards show what really happened. Marking it `pendente`
 * instead would leave rows open forever when the command really was lost.
 * @returns {Promise<{ok: true} | {ok: false, code: string, status: number|null, message: string}>}
 */
export async function requestOtaCommand(supabaseClient, deployId) {
  const { error } = await supabaseClient.functions.invoke('ota-command', {
    body: { deploy_id: deployId },
  });
  if (!error) return { ok: true };

  const status = error.context?.status ?? null;
  let code = status ? 'http_error' : 'network_error';
  if (error.context?.json) {
    try {
      const body = await error.context.json();
      if (body?.error) code = String(body.error);
    } catch { /* body is not JSON; keep generic code */ }
  }

  if (status !== 502) {
    try {
      await supabaseClient
        .from('firmware_deploys')
        .update({ status: 'falha', confirmado_em: new Date().toISOString() })
        .eq('id', deployId);
    } catch { /* history is best-effort here */ }
  }

  return { ok: false, code, status, message: otaErrorMessage(code) };
}

/**
 * Último deploy de firmware com sucesso da bóia (boia_id = código do cadastro),
 * ou null. Usado pelo modal de detalhes quando a bóia ainda não mandou status.
 */
export async function ultimoDeploy(supabaseClient, boiaId) {
  const { data, error } = await supabaseClient
    .from('firmware_deploys')
    .select('*')
    .eq('boia_id', boiaId)
    .eq('status', 'sucesso')
    .order('data_deploy', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Apaga o .bin do bucket `firmware` (M6: upload feito, mas o insert do deploy
 * ou a Edge Function falhou). Nunca lança; false se não removeu.
 */
export async function removeFirmwareFile(supabaseClient, path) {
  if (!path) return false;
  try {
    const { error } = await supabaseClient.storage.from('firmware').remove([path]);
    return !error;
  } catch {
    return false;
  }
}

/**
 * O .bin só é apagado quando a recusa é definitiva (houve resposta HTTP). Em
 * erro de rede (status null) a função pode ter publicado o comando e a bóia
 * ainda baixar o arquivo: apagar quebraria um OTA possivelmente em curso.
 */
export function deveRemoverBin(result) {
  return result?.ok === false && result.status != null;
}

/** Últimos deploys (mais recentes primeiro). Lança em erro de leitura. */
export async function listarDeploys(supabaseClient, limit = 20) {
  const { data, error } = await supabaseClient
    .from('firmware_deploys')
    .select('id, boia_id, versao, status, operador_nome, data_deploy, confirmado_em')
    .order('data_deploy', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
