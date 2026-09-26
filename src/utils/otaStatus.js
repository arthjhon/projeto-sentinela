// Regras para interpretar <deviceId>/ota/status no formulário de deploy.
//
// useMqtt guarda só o último payload de cada tópico, e o effect que lê esse
// estado roda a cada mensagem MQTT (o status da bóia chega a cada 5 s). Sem
// estas regras o mesmo payload era tratado de novo a cada mensagem, e o
// "success" retido de um OTA anterior — entregue pelo broker ao abrir a
// página — travava o formulário em "success" e fechava o histórico de um
// deploy novo antes de a bóia responder.

const DEPLOY_ACTIVE = ['sending', 'waiting'];

/**
 * true se a mensagem é nova e há um deploy desta página esperando resposta.
 * JSON.parse cria um objeto por mensagem, então a identidade distingue mensagens.
 *
 * @param {object|undefined} otaData   payload atual do tópico
 * @param {object|undefined} lastSeen  último payload já tratado para o tópico
 * @param {string} phase               fase do formulário
 */
export function isFreshDeployEvent(otaData, lastSeen, phase) {
  return !!otaData && otaData !== lastSeen && DEPLOY_ACTIVE.includes(phase);
}

/** Fase do formulário correspondente ao status publicado pelo firmware, ou null. */
export function phaseFromOtaStatus(status) {
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'downloading' || status === 'flashing') return 'waiting';
  return null;
}
