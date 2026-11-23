import { leituraMsDaChegada, ROTULO_CONEXAO, TOM_CONEXAO } from './buoyConnection';
import { formatData } from './format';
import { formatValor, mensagemDaSessao, resumoBoia } from './dashboardView';
import { valorAtual } from './dashboard';
import { serialValido } from './deviceIds';
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

/** Formulário de edição a partir de uma entrada do registro (ausentes viram '' / padrão). */
export function formDoRegistro(reg) {
  return {
    id: reg.codigo,
    deviceId: reg.deviceId ?? '',
    deviceIdsAnteriores: reg.deviceIdsAnteriores ?? [],
    name: reg.nome ?? '',
    lagoa: reg.lagoa ?? 'mundau',
    modo: normalizeModo(reg.modo),
    lat: reg.lat ?? '',
    lng: reg.lng ?? '',
  };
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

const DIAG_CLASSE = { ok: 'online', 'sem-valor': 'warning', 'sem-leitura': 'offline' };

/**
 * Linha da tabela de uma bóia, derivada só do que é real: registro (identidade,
 * posição), LWT, mensagens MQTT VIVAS desta sessão (retidas não contam) e, como na
 * Visão geral, as últimas leituras GRAVADAS (`ultimas`, InfluxDB) como piso da
 * "última leitura". Conexão e hora da leitura saem de resumoBoia (a mesma função da
 * Visão geral): mesma entrada, mesmo estado. `mensagens`/`chegadas` = messages/receivedAt do useMqtt.
 */
export function montarLinhaBoia({ registro, mensagens, chegadas, ultimas = [], agoraMs, brokerConectado = true }) {
  const serial = serialValido(registro);
  const modo = normalizeModo(registro.modo);
  const topico = (t) => (serial ? `${serial}/${t}` : null);
  const chegStatus = serial ? chegadas[topico('status')] : undefined;
  const chegSensores = serial ? chegadas[topico('sensores')] : undefined;
  const leitura = serial ? mensagemDaSessao(mensagens[topico('sensores')], chegSensores) : null;
  const status = serial ? mensagemDaSessao(mensagens[topico('status')], chegStatus) : null;
  const lwt = serial ? mensagens[topico('availability')] : undefined;
  const resumo = resumoBoia({
    buoy: registro, mqtt: { lwt, sensores: leitura }, ultimas, healthRows: [], agoraMs, brokerConectado,
  });
  const conexao = resumo.conexao;
  const ultimaLeituraMs = resumo.ultimaMs;
  const idadeLeitura = ultimaLeituraMs == null ? null : agoraMs - ultimaLeituraMs;
  const recebidoStatus = leituraMsDaChegada(chegStatus);
  const saude = status ? Object.fromEntries(Object.entries(status).filter(([k]) => k !== '_recebidoEm')) : {};
  return {
    id: registro.codigo,
    nome: registro.nome,
    deviceId: serial ?? '',
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
      // valor ao vivo, ou o gravado mais recente (mesma regra da Visão geral)
      const { valor } = valorAtual({ mqtt: leitura, ultimas }, s.key);
      const diag = serial ? sensorDiagnosis(valor == null ? undefined : { [s.key]: valor }, s.key, idadeLeitura) : 'sem-leitura';
      return { ...s, diag, classe: DIAG_CLASSE[diag], valor: formatValor(valor, s.key) };
    }),
  };
}
