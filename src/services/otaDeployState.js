// Lógica pura do formulário de deploy OTA (sem React, sem I/O): máquina de
// estados, token de requisição, validação do nome do arquivo e o status
// efetivo de uma linha de firmware_deploys.

/** Sem resposta da bóia depois do comando enviado: libera o formulário. */
export const WAIT_TIMEOUT_MS = 120_000;
/** Deploy `pendente` mais velho que isto é exibido como "sem resposta". */
export const PENDENTE_STALE_MS = 15 * 60_000;

export const initialState = Object.freeze({
  phase: 'idle', // idle | uploading | sending | waiting | success | error | timeout
  deployId: null,
  deviceId: null,
  log: [],
});

const ACTIVE = ['sending', 'waiting'];
// 'uploading' entra: o upload do Storage não tem abort/timeout; o token de
// execução do hook descarta a continuação e remove o .bin enviado.
const RESETAVEIS = ['uploading', 'sending', 'waiting', 'timeout', 'error', 'success'];

/** Reset disponível em toda fase exceto idle. */
export const podeResetar = (phase) => RESETAVEIS.includes(phase);

const line = (a, msg) => `${a.ts ? `[${a.ts}] ` : ''}${msg}`;
const addLog = (s, a, msg) => ({ ...s, log: [...s.log, line(a, msg)] });

/** Fase correspondente ao status publicado pelo firmware, ou null. */
export function faseDoStatus(status) {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'downloading' || status === 'flashing') return 'waiting';
  return null;
}

export function otaReducer(state, action) {
  switch (action.type) {
    case 'start':
      return { ...initialState, phase: 'uploading', deviceId: action.deviceId, log: state.log };
    case 'deploy_created':
      return { ...state, phase: 'sending', deployId: action.deployId };
    case 'command_sent':
      // Só sai de 'sending': uma recusa rápida da bóia (same_version, busy...)
      // pode chegar pelo WSS antes da resposta HTTP e já ter fechado a fase.
      return state.phase === 'sending' ? { ...state, phase: 'waiting' } : state;
    case 'device_status': {
      if (!ACTIVE.includes(state.phase)) return state;
      const next = faseDoStatus(action.status);
      return next ? { ...state, phase: next } : state;
    }
    case 'timeout':
      if (state.phase !== 'waiting') return state;
      return addLog({ ...state, phase: 'timeout' }, action,
        'Sem resposta da bóia em 120 s. O deploy segue pendente; confira o card da frota ou tente de novo.');
    case 'fail':
      return addLog({ ...state, phase: 'error' }, action, `ERRO: ${action.message}`);
    case 'log':
      return addLog(state, action, action.message);
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

/** `.bin` sem diferenciar maiúsculas. */
export function isBinFile(name) {
  return typeof name === 'string' && name.length > 4 && name.toLowerCase().endsWith('.bin');
}

/**
 * Token de requisição: só a chamada mais recente pode aplicar o resultado
 * (hash assíncrono de arquivos em sequência, deploy cancelado por reset).
 */
export function createRequestToken() {
  let current = 0;
  return {
    next: () => ++current,
    isLatest: (t) => t === current,
    invalidate: () => { current++; },
  };
}

/** Status mostrado na tabela: `pendente` antigo vira `sem_resposta` (só exibição). */
export function statusEfetivo(deploy, agoraMs) {
  if (deploy?.status !== 'pendente') return deploy?.status;
  const t = Date.parse(deploy.data_deploy);
  if (!Number.isFinite(t)) return 'pendente';
  return agoraMs - t > PENDENTE_STALE_MS ? 'sem_resposta' : 'pendente';
}

const ROTULOS = {
  pendente: { texto: 'pendente', tom: 'neutral' },
  sucesso: { texto: 'sucesso', tom: 'ok' },
  falha: { texto: 'falha', tom: 'bad' },
  revertido: { texto: 'revertido', tom: 'warn' },
  sem_resposta: { texto: 'sem resposta', tom: 'warn' },
};

export function rotuloStatusDeploy(status) {
  return ROTULOS[status] ?? { texto: String(status ?? '—'), tom: 'neutral' };
}

/**
 * O ota/status é desta tentativa? O campo `firmware` do payload é a versão EM
 * EXECUÇÃO ao publicar (até o "success" sai com a versão antiga, antes do
 * restart), então não identifica o deploy: a correlação é por hora de chegada.
 * Vale só evento ao vivo (não retido) recebido depois do início do comando
 * deste deploy; um success tardio de uma tentativa anterior (timeout) que
 * chegou antes do reenvio não fecha a linha da nova.
 * Limite: evento tardio que chegue DEPOIS do reenvio é indistinguível.
 *
 * @param {{at:number, retained:boolean}|undefined} chegada  receivedAt[topico] do useMqtt
 * @param {number|null} enviadoEm  Date.now() de antes de pedir o comando; null = ainda não enviado
 */
export function eventoDoDeploy(chegada, enviadoEm) {
  if (!chegada || chegada.retained || enviadoEm == null) return false;
  return Number.isFinite(chegada.at) && chegada.at >= enviadoEm;
}
