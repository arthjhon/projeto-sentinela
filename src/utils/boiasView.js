import { estadoConexao, leituraMsDaChegada, ROTULO_CONEXAO, TOM_CONEXAO } from './buoyConnection';
import { formatData } from './format';
import { formatValor, mensagemDaSessao } from './dashboardView';
import { deviceIdsOf, serialValido } from './deviceIds';
import { sensorDiagnosis, formatCoords } from './buoyRuntime';
import { LAGOA_LABEL, normalizeModo } from '../services/buoyRegistry';

// Lógica pura da página Bóias (sem React, sem I/O): linhas da tabela, rótulos de
// calibração/manutenção e permissões de ação. `agoraMs` sempre vem de quem chama.

/** Sensores que o firmware publica em <deviceId>/sensores. `name` é também a chave
 *  das calibrações gravadas no Supabase (sensor_calibrations.sensor_key): não renomear. */
export const SENSORES_BOIA = [
  { name: 'Turbidez', key: 'turbidez' },
  { name: 'Sensor de pH', key: 'ph' },
  { name: 'Termômetro', key: 'temperatura' },
];

/** Formulário de cadastro de bóia, vazio. */
export const FORM_VAZIO = { id: '', deviceId: '', name: '', lagoa: 'mundau', modo: 'bancada', lat: '', lng: '' };

export const MIN_OBSERVACAO = 10;

/** Observação obrigatória da calibração (padrão/solução usada): >= 10 caracteres úteis. */
export function validarObservacaoCalibracao(texto) {
  const limpo = typeof texto === 'string' ? texto.trim() : '';
  if (limpo.length < MIN_OBSERVACAO) {
    return { ok: false, texto: limpo, erro: `Descreva o padrão ou a solução usada (mínimo ${MIN_OBSERVACAO} caracteres).` };
  }
  return { ok: true, texto: limpo, erro: null };
}

/** "registrada por X em DD/MM/AAAA" a partir do registro de sensor_calibrations. */
export function rotuloCalibracao(registro) {
  if (!registro) return 'nunca registrada';
  const quem = registro.operador_nome ? ` por ${registro.operador_nome}` : '';
  return `registrada${quem} em ${formatData(registro.calibrated_at)}`;
}

/** O firmware informa explicitamente "não calibrado" (diverge de qualquer registro manual). */
export function divergeFirmware(saude) {
  return saude?.calibrated === false;
}

/**
 * Manutenção aberta na linha da bóia. `manutencao`: registro aberto | null |
 * 'erro' (leitura falhou) | undefined (ainda não lida). Falha nunca some.
 */
export function rotuloManutencaoAberta(manutencao, agoraMs) {
  if (manutencao === 'erro') return 'manutenção: indisponível';
  if (!manutencao) return null;
  const inicio = Date.parse(manutencao.timestamp_inicio);
  if (!Number.isFinite(inicio)) return 'em manutenção';
  const dias = Math.floor((agoraMs - inicio) / 86_400_000);
  return dias >= 1 ? `em manutenção há ${dias} d` : 'em manutenção desde hoje';
}

const PERMISSOES = { cadastro: ['admin'], manutencao: ['admin', 'operador'], calibracao: ['admin', 'operador'] };
const MOTIVO_SEM_PERMISSAO = {
  cadastro: 'Somente administradores cadastram, editam ou removem bóias.',
  manutencao: 'Seu perfil não pode registrar manutenção.',
  calibracao: 'Seu perfil não pode registrar calibração.',
};

/** Pode o perfil executar a ação? Bloqueado vem com a explicação para o tooltip (desabilitar, nunca esconder). */
export function permissaoAcao(role, acao) {
  if ((PERMISSOES[acao] ?? []).includes(role)) return { permitido: true, motivo: undefined };
  if (role === 'visualizador') return { permitido: false, motivo: 'Indisponível no modo demonstração.' };
  return { permitido: false, motivo: MOTIVO_SEM_PERMISSAO[acao] ?? 'Ação indisponível.' };
}

/** Histórico e exportação vivem no painel (uma só tela, um só CSV). */
export function hrefHistorico(codigo) {
  return `/admin/dashboard?boia=${encodeURIComponent(codigo)}`;
}

/** Valor de um sensor com as casas e a unidade de WATER_PARAMS (1 casa nas decimais pt-BR, ver formatValor). */
export function valorSensor(valor, campo) {
  return formatValor(valor, campo);
}

const DIAG_CLASSE = { ok: 'online', 'sem-valor': 'warning', 'sem-leitura': 'offline' };

/**
 * Linha da tabela de uma bóia, derivada só do que é real: registro (identidade,
 * posição), LWT e mensagens MQTT VIVAS desta sessão (retidas não contam, como na
 * Visão geral e no Status). `mensagens`/`chegadas` = messages/receivedAt do useMqtt.
 */
export function montarLinhaBoia({ registro, mensagens, chegadas, agoraMs, brokerConectado = true }) {
  const serial = serialValido(registro);
  const modo = normalizeModo(registro.modo);
  const topico = (t) => (serial ? `${serial}/${t}` : null);
  const chegSensores = serial ? chegadas[topico('sensores')] : undefined;
  const chegStatus = serial ? chegadas[topico('status')] : undefined;
  const leitura = serial ? mensagemDaSessao(mensagens[topico('sensores')], chegSensores) : null;
  const status = serial ? mensagemDaSessao(mensagens[topico('status')], chegStatus) : null;
  const ultimaLeituraMs = leituraMsDaChegada(chegSensores);
  const idadeLeitura = ultimaLeituraMs == null ? null : agoraMs - ultimaLeituraMs;
  const recebidoStatus = leituraMsDaChegada(chegStatus);
  const conexao = estadoConexao({
    modo,
    lwt: serial ? mensagens[topico('availability')] : undefined,
    ultimaLeituraMs: ultimaLeituraMs ?? undefined,
    agoraMs,
    brokerConectado,
    temHardware: Boolean(serial),
  });
  const saude = status ? Object.fromEntries(Object.entries(status).filter(([k]) => k !== '_recebidoEm')) : {};
  return {
    id: registro.codigo,
    nome: registro.nome,
    deviceId: serial ?? '',
    historyIds: deviceIdsOf(registro),
    local: LAGOA_LABEL[registro.lagoa] ?? registro.lagoa,
    modo,
    coordenadas: formatCoords(registro.lat, registro.lng),
    conexao,
    rotuloConexao: ROTULO_CONEXAO[conexao],
    tom: TOM_CONEXAO[conexao],
    ultimaLeituraMs,
    idadeLeitura,
    intervaloMs: chegSensores && !chegSensores.retained && chegSensores.prevAt ? chegSensores.at - chegSensores.prevAt : null,
    statusIdadeMs: recebidoStatus == null ? null : agoraMs - recebidoStatus,
    // o firmware atual não mede bateria; aparece quando o /status trouxer
    bateria: Number.isFinite(saude.battery) ? saude.battery : null,
    saude,
    sensores: SENSORES_BOIA.map((s) => {
      const diag = serial ? sensorDiagnosis(leitura, s.key, idadeLeitura) : 'sem-leitura';
      return { ...s, diag, classe: DIAG_CLASSE[diag], valor: valorSensor(leitura?.[s.key], s.key) };
    }),
  };
}
