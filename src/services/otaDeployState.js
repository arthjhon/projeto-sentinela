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
const RESETAVEIS = ['sending', 'waiting', 'timeout', 'error', 'success'];

/** Reset disponível fora de idle e de uploading (o upload não é cancelável). */
export const podeResetar = (phase) => RESETAVEIS.includes(phase);

const line = (a, msg) => `${a.ts ? `[${a.ts}] ` : ''}${msg}`;
const addLog = (s, a, msg) => ({ ...s, log: [...s.log, line(a, msg)] });

/** Fase correspondente ao status publicado pelo firmware, ou null. */
function faseDoStatus(status) {
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
