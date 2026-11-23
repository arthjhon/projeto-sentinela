import { leituraMsDaChegada } from './buoyConnection';
import { formatIdade, formatRssi, formatUptime } from './format';
import { mensagemDaSessao, resumoBoia } from './dashboardView';
import { serialValido } from './deviceIds';
import { normalizeModo } from '../services/buoyRegistry';

// Entrada única de "conexão da bóia" para Status e Firmware (e a mesma que Visão
// geral e Bóias já usam): registro + MQTT desta sessão + últimas leituras GRAVADAS
// (InfluxDB). Sem a leitura gravada, a bóia aparecia "online, sem leitura" nos
// primeiros segundos dessas telas, até chegar a primeira mensagem ao vivo.

/**
 * Estado de conexão e hora da última leitura de uma bóia do cadastro, pela mesma
 * função da Visão geral (resumoBoia). `mensagens`/`chegadas` = messages/receivedAt
 * do useMqtt; `ultimas` = leituras gravadas só dos seriais dela.
 * @returns {{serial: string|null, modo: string, estado: string, ultimaMs: number|null}}
 */
export function conexaoDoRegistro({ registro, mensagens, chegadas, ultimas = [], agoraMs, brokerConectado = true }) {
  const serial = serialValido(registro);
  const topico = (t) => `${serial}/${t}`;
  const sensores = serial ? mensagemDaSessao(mensagens?.[topico('sensores')], chegadas?.[topico('sensores')]) : null;
  const lwt = serial ? mensagens?.[topico('availability')] : undefined;
  const resumo = resumoBoia({ buoy: registro, mqtt: { lwt, sensores }, ultimas, healthRows: [], agoraMs, brokerConectado });
  return { serial, modo: normalizeModo(registro?.modo), estado: resumo.conexao, ultimaMs: resumo.ultimaMs };
}

/**
 * Firmware, RSSI e uptime do /status, já formatados, com a idade da mensagem.
 * Mensagem retida: `idade` null (a chegada marca o subscribe, não a bóia) e
 * `retida` true. Ausente/inválido = null em cada campo.
 */
export function saudeDoStatus({ status, chegada, agoraMs }) {
  const ok = status && typeof status === 'object';
  const retida = Boolean(ok && chegada?.retained);
  const ms = ok && !retida ? leituraMsDaChegada(chegada) : null;
  return {
    firmware: ok && typeof status.firmware === 'string' && status.firmware ? status.firmware : null,
    rssi: ok ? formatRssi(status.rssi) : null,
    uptime: ok ? formatUptime(status.uptime) : null,
    idade: ms == null ? null : formatIdade(agoraMs - ms),
    retida,
  };
}

/**
 * Bóias da tela de Firmware. Enquanto o cadastro carrega e não há lista, vazio:
 * a semente (`fleet`) não é a frota e não deve piscar como se fosse. Identidade do
 * cadastro; `fleet` só completa metadados por código. deviceId inválido = null.
 */
export function frotaDoOta({ registro, carregando, fleet }) {
  if (carregando && !registro.length) return [];
  return registro.map((r) => ({
    ...fleet.find((f) => f.id === r.codigo),
    id: r.codigo,
    name: r.nome,
    deviceId: serialValido(r),
    modo: r.modo,
  }));
}
