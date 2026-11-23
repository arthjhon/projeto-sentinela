// Regras puras do botão "Reiniciar placa" (comando remoto, firmware >= 5.2.0).

export const FIRMWARE_MIN_REINICIO = '5.2.0';
export const REINICIO_TIMEOUT_MS = 180000;
export const REINICIO_FOLGA_S = 30;

function parseVersao(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(typeof v === 'string' ? v.trim() : '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Compara os três números iniciais; sufixos (`-teste`) são ignorados. */
export function firmwareSuportaReinicio(versao) {
  const v = parseVersao(versao);
  if (!v) return false;
  const min = parseVersao(FIRMWARE_MIN_REINICIO);
  for (let i = 0; i < 3; i += 1) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

export function permissaoReinicio({ role, isFallback, serial, conexao, firmware }) {
  const nega = (motivo) => ({ permitido: false, motivo });
  if (role === 'visualizador') return nega('Indisponível no modo demonstração.');
  if (role !== 'admin') return nega('Somente administradores reiniciam a placa.');
  if (isFallback) return nega('Cadastro indisponível: ficha só leitura.');
  if (!serial) return nega('Bóia sem placa cadastrada.');
  if (conexao !== 'online') return nega('A placa precisa estar online.');
  if (!parseVersao(firmware)) return nega('Versão do firmware desconhecida.');
  if (!firmwareSuportaReinicio(firmware)) {
    return nega(`Requer firmware ${FIRMWARE_MIN_REINICIO} ou mais novo (placa em ${firmware}).`);
  }
  return { permitido: true };
}

/**
 * Acompanha o reinício pedido em `enviadoEmMs`. Só um /status recebido depois
 * do envio, com reset_reason 'remote' e uptime coerente com o tempo decorrido,
 * confirma; /status de conexão (sem uptime) ou retido/atrasado não conta.
 */
export function estadoReinicio({ enviadoEmMs, agoraMs, statusMsg }) {
  const recebido = statusMsg?._recebidoEm;
  if (
    Number.isFinite(recebido) && recebido >= enviadoEmMs
    && statusMsg.reset_reason === 'remote'
    && Number.isFinite(statusMsg.uptime)
    && statusMsg.uptime <= (agoraMs - enviadoEmMs) / 1000 + REINICIO_FOLGA_S
  ) return 'confirmado';
  return agoraMs - enviadoEmMs > REINICIO_TIMEOUT_MS ? 'sem-confirmacao' : 'aguardando';
}
