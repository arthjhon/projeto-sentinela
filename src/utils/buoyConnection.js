// Única definição de "a bóia está online" do painel admin. Todas as telas
// (Visão geral, Bóias, Status, Firmware) consomem estadoConexao; nenhuma
// deriva o estado por conta própria. Puro: sem React, sem I/O; `agoraMs` vem
// de quem chama.

/** Leitura mais velha que isto deixa a bóia 'sem-leitura' (online pelo LWT, mas muda). */
export const SEM_LEITURA_MS = 60000;

export const ESTADOS_CONEXAO = Object.freeze([
  'online', 'sem-leitura', 'offline', 'bancada-offline', 'bancada-sem-leitura', 'sem-broker', 'sem-hardware', 'desconhecido',
]);

/** Texto curto de cada estado (o de 'sem-leitura' pode ganhar a idade, ver dashboardView.rotuloConexao). */
export const ROTULO_CONEXAO = Object.freeze({
  online: 'online',
  'sem-leitura': 'online, sem leitura',
  offline: 'offline',
  'bancada-offline': 'bancada, offline é normal',
  'bancada-sem-leitura': 'bancada, online, sem leitura',
  'sem-broker': 'painel sem conexão com o broker',
  'sem-hardware': 'sem hardware',
  desconhecido: 'sem sinal',
});

/** Tom de cada estado: ok | warn | bad | neutral. Só 'offline' é vermelho. */
export const TOM_CONEXAO = Object.freeze({
  online: 'ok',
  'sem-leitura': 'warn',
  offline: 'bad',
  'bancada-offline': 'neutral',
  'bancada-sem-leitura': 'neutral',
  'sem-broker': 'neutral',
  'sem-hardware': 'neutral',
  desconhecido: 'neutral',
});

/**
 * Hora de chegada (ms) de uma mensagem MQTT para fins de "última leitura".
 * `chegada` = receivedAt[topico] do useMqtt. Mensagem retida não conta: o
 * broker a entrega no subscribe e a hora é da entrega, não do device.
 */
export function leituraMsDaChegada(chegada) {
  if (!chegada || chegada.retained === true) return null;
  return Number.isFinite(chegada.at) ? chegada.at : null;
}

/**
 * Estado de conexão de UMA bóia, em ordem de precedência:
 *  1. sem hardware (`temHardware === false`)            -> 'sem-hardware'
 *  2. painel fora do broker (`brokerConectado === false`) -> 'sem-broker' (o LWT guardado
 *     é velho e a falta de leitura é do painel; nunca afirma online/offline)
 *  3. campo: LWT 'offline' -> 'offline'; LWT 'online' -> 'online' se houve leitura
 *     há <= SEM_LEITURA_MS, senão 'sem-leitura'; sem LWT -> 'online' com leitura
 *     recente, senão 'desconhecido'
 *  4. bancada (`modo === 'bancada'`): mesmo cálculo, mas sem vermelho: 'offline' e
 *     'desconhecido' viram 'bancada-offline' (offline é normal em bancada) e
 *     'sem-leitura' (LWT diz online, placa muda) vira 'bancada-sem-leitura' — nunca
 *     rotulado como offline, porque o LWT diz o contrário.
 * `ultimaLeituraMs` deve vir de leituraMsDaChegada / ultimaLeituraMs (retida não conta).
 * `temHardware` e `brokerConectado` omitidos valem true.
 */
export function estadoConexao({
  modo, lwt, ultimaLeituraMs, agoraMs, brokerConectado = true, temHardware = true,
} = {}) {
  if (temHardware === false) return 'sem-hardware';
  if (brokerConectado === false) return 'sem-broker';
  const recente = Number.isFinite(ultimaLeituraMs) && agoraMs - ultimaLeituraMs <= SEM_LEITURA_MS;
  let estado;
  if (lwt === 'offline') estado = 'offline';
  else if (lwt === 'online') estado = recente ? 'online' : 'sem-leitura';
  else estado = recente ? 'online' : 'desconhecido';
  if (modo === 'bancada') {
    if (estado === 'sem-leitura') return 'bancada-sem-leitura';
    if (estado !== 'online') return 'bancada-offline';
  }
  return estado;
}
