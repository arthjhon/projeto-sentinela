import { estadoConexao, valorAtual, piorSaude, num, SEM_LEITURA_MS } from './dashboard';
import { serialValido } from './deviceIds';
import { healthForDevice, jobStaleness, jobTitle } from '../services/sensorHealth';
import { normalizeModo } from '../services/buoyRegistry';
import { WATER_PARAMS } from '../config/waterQuality';

// Formatação e resumo da visão geral (faixa da frota e painel da bóia).
// Puro: sem React, sem I/O; `agoraMs` sempre vem de quem chama.

export const CAMPOS = ['temperatura', 'ph', 'turbidez'];

/** Tom (rotuloConexao, estadoMeta) -> classe de badge de shared.css / SensorHealth.css. */
export const TOM_CLASSE = {
  ok: 'badge-online', warn: 'badge-warning', bad: 'badge-offline', info: 'sh-info', neutral: 'badge-planejada',
};

/** Idade legível: "há 4 s", "há 3 min", "há 2 h", "há 3 d"; sem valor = null. */
export function formatIdade(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 0) return 'agora'; // relógio do navegador atrás do device
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/**
 * Mensagem MQTT recebida nesta sessão, com a hora de chegada em `_recebidoEm`.
 * Retida não conta (o broker entrega a última no subscribe: é velha), nem
 * payload que não é objeto ou sem hora de chegada. `chegada` = receivedAt[topico] do useMqtt.
 */
export function mensagemDaSessao(msg, chegada) {
  if (!msg || typeof msg !== 'object' || !chegada || chegada.retained) return null;
  return { ...msg, _recebidoEm: chegada.at };
}

/** Última leitura: mensagem MQTT da sessão; sem ela, o _time mais recente de `ultimas`. */
export function ultimaLeituraMs({ sensores, ultimas } = {}) {
  const ao = Number(sensores?._recebidoEm);
  if (sensores && Number.isFinite(ao)) return ao;
  const t = ultimas?.length ? +ultimas[0].time : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Bóia sem serial não tem conexão a avaliar. Com o PAINEL desconectado do
 * broker (`brokerConectado === false`), o LWT guardado é velho e a falta de
 * leitura é do painel, não da bóia: 'sem-broker', sem afirmar online/offline.
 * Fora isso, segue estadoConexao. Sem o parâmetro, vale conectado.
 */
export function conexaoDaBoia({ deviceId, lwt, ultimaMs, agoraMs, brokerConectado = true }) {
  if (!deviceId) return 'sem-hardware';
  if (brokerConectado === false) return 'sem-broker';
  return estadoConexao({ lwt, ultimaLeituraMs: ultimaMs ?? undefined, agoraMs });
}

/** Aviso do topo: null (conectado) | 'conectando' (nunca conectou nesta montagem) | 'desconectado' (caiu). */
export function avisoBroker({ conectado, jaConectou }) {
  if (conectado) return null;
  return jaConectou ? 'desconectado' : 'conectando';
}

const CONEXAO = {
  online: { texto: 'online', tom: 'ok' },
  offline: { texto: 'offline', tom: 'bad' },
  'sem-leitura': { texto: 'online, sem leitura', tom: 'warn' },
  desconhecido: { texto: 'sem sinal', tom: 'neutral' },
  'sem-hardware': { texto: 'sem hardware', tom: 'neutral' },
  'sem-broker': { texto: 'painel sem conexão com o broker', tom: 'neutral' },
};

/** Rótulo e tom (ok | warn | bad | neutral) do estado de conexão. */
export function rotuloConexao(estado, idade) {
  const base = CONEXAO[estado] ?? CONEXAO.desconhecido;
  if (estado === 'sem-leitura' && idade) return { ...base, texto: `${base.texto} ${idade}` };
  return { ...base };
}

const p2 = (n) => String(n).padStart(2, '0');

/** "gravada às HH:MM" (mesmo dia) ou "gravada em DD/MM às HH:MM"; hora local. */
export function rotuloGravada(emMs, agoraMs) {
  if (emMs == null || !Number.isFinite(emMs)) return null;
  const d = new Date(emMs);
  const hoje = new Date(agoraMs);
  const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const mesmoDia = d.getFullYear() === hoje.getFullYear()
    && d.getMonth() === hoje.getMonth() && d.getDate() === hoje.getDate();
  return mesmoDia ? `gravada às ${hora}` : `gravada em ${p2(d.getDate())}/${p2(d.getMonth() + 1)} às ${hora}`;
}

/** Rótulo do eixo de tempo: 1h/24h só a hora; 7d/30d com a data (30 dias de "14:32" não diz nada). */
export function formatTick(ms, periodo) {
  const d = new Date(ms);
  const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return periodo === '1h' || periodo === '24h' ? hora : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${hora}`;
}

const PARAM = Object.fromEntries(WATER_PARAMS.map((p) => [p.key, p]));

/** Valor com as casas e a unidade do parâmetro (pt-BR); ausente = "sem leitura". */
export function formatValor(valor, campo) {
  if (valor == null || !Number.isFinite(Number(valor))) return 'sem leitura';
  const p = PARAM[campo];
  const casas = p?.decimals ?? 2;
  const n = Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return p?.unit ? `${n} ${p.unit}` : n;
}

/** Mínimo e máximo dos valores presentes (zero conta); nenhum = null. */
export function minMax(valores) {
  const vs = (valores ?? []).filter((v) => v != null && Number.isFinite(v));
  if (!vs.length) return null;
  return { min: Math.min(...vs), max: Math.max(...vs) };
}

const DIA_MS = 86400e3;

/**
 * Mín./máx. das últimas 24 h de um campo: médias de 10 min gravadas
 * (`hist24[campo]`, history 24h) + leituras brutas de `ultimas` + o buffer MQTT
 * da sessão (`buffer`: [{ts, <campo>}]), estes dois só com até 24 h (borda
 * inclusa). `hist24` null = carregando (undefined); {erro} = 'erro'; nenhum
 * valor = null.
 */
export function extremos24h(hist24, ultimas, campo, agoraMs, buffer = []) {
  if (hist24 === null) return undefined;
  if (hist24.erro) return 'erro';
  const brutas = (ultimas ?? []).filter((r) => agoraMs - r.time <= DIA_MS).map((r) => num(r[campo]));
  const aoVivo = (buffer ?? []).filter((e) => agoraMs - e.ts <= DIA_MS).map((e) => num(e[campo]));
  return minMax([...(hist24[campo] ?? []).map((d) => d.value), ...brutas, ...aoVivo]);
}

/**
 * Origem do valor no card. Mensagem MQTT com mais de 60 s (SEM_LEITURA_MS) não
 * é "ao vivo": diz "recebida há X". Sem hora de chegada, "ao vivo" sem idade.
 */
export function rotuloOrigem(atual, agoraMs) {
  if (atual.fonte === 'ao-vivo') {
    if (atual.em == null) return 'ao vivo';
    const ms = agoraMs - atual.em;
    return ms > SEM_LEITURA_MS ? `recebida ${formatIdade(ms)}` : `ao vivo, ${formatIdade(ms)}`;
  }
  if (atual.fonte === 'gravada') return rotuloGravada(atual.em, agoraMs);
  return 'nem no MQTT nem no histórico gravado';
}

/** Texto de "sem saúde para mostrar": leitura falhou x bóia sem linhas (mesmo texto no card e no painel). */
export const textoSemSaude = (indisponivel) => (indisponivel ? 'saúde indisponível' : 'sem avaliação');

/**
 * Selo de manutenção do card. `manutencao`: registro aberto | null (nenhuma) |
 * 'erro' (leitura falhou) | undefined (ainda não lida). Falha nunca some.
 */
export function seloManutencao(manutencao) {
  if (manutencao === 'erro') return { tipo: 'indisponivel', texto: 'manutenção: indisponível' };
  if (manutencao) return { tipo: 'aberta', texto: 'em manutenção', title: manutencao.motivo ?? undefined };
  return null;
}

/**
 * Série do gráfico: histórico gravado ([{time: Date, value}]) + leituras MQTT
 * da sessão ([{ts, <campo>}]) posteriores ao último ponto gravado. O Telegraf
 * grava em lote; sem isso o gráfico parece parado entre uma gravação e outra.
 */
export function serieGrafico(history, buffer, campo) {
  const pontos = (history ?? []).map((d) => ({ t: d.time.getTime(), value: d.value }));
  const ultimo = pontos.at(-1)?.t ?? -Infinity;
  for (const e of buffer ?? []) {
    if (e.ts > ultimo && e[campo] != null) pontos.push({ t: e.ts, value: e[campo] });
  }
  return pontos;
}

const JOB_ROTULO = { openmeteo: 'Open-Meteo', ana: 'ANA', detector: 'Detector' };

/**
 * Estado da coleta do worker para a UI: `jobs` undefined = carregando, null =
 * leitura falhou. {tipo: 'carregando' | 'falha' | 'vazio' | 'itens', itens?}.
 */
export function estadoColeta(jobs, agora) {
  if (jobs === undefined) return { tipo: 'carregando' };
  if (jobs === null) return { tipo: 'falha' };
  const itens = resumoColeta(jobs, agora);
  return itens.length ? { tipo: 'itens', itens } : { tipo: 'vazio' };
}

/**
 * Resumo da coleta do worker: um item por job (menos `status`, que é sinal da
 * página Status do sistema, não coleta). Falha vence atraso.
 */
export function resumoColeta(jobs, agora) {
  const lista = (jobs ?? []).filter((j) => j.job !== 'status');
  const stale = jobStaleness(lista, agora);
  return lista.map((j, i) => {
    const s = stale[i];
    const t = j.ultimo_sucesso ? Date.parse(j.ultimo_sucesso) : NaN;
    return {
      job: j.job,
      rotulo: JOB_ROTULO[j.job] ?? j.job,
      estado: s.ok === false ? 'falha' : s.atrasado ? 'atrasado' : 'ok',
      title: jobTitle(s),
      ultimoSucessoMs: Number.isFinite(t) ? t : null,
    };
  });
}

/**
 * Resumo de uma bóia para o card e o painel. `mqtt` = {lwt, sensores} da
 * própria bóia; `brokerConectado` = useMqtt().connected; `ultimas` = leituras gravadas só dos seriais dela. Saúde pelo
 * serial atual (healthForDevice, com a precedência de bancada do cadastro).
 */
export function resumoBoia({ buoy, mqtt, ultimas, healthRows, agoraMs, brokerConectado = true }) {
  const modo = normalizeModo(buoy?.modo);
  const sensores = mqtt?.sensores ?? null;
  const ultimaMs = ultimaLeituraMs({ sensores, ultimas });
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, valorAtual({ mqtt: sensores, ultimas }, c)]));
  // serial fora do formato = sem serial válido (igual ao painel, que só usa deviceIdsOf)
  const serial = serialValido(buoy);
  const saude = serial ? piorSaude(healthForDevice(healthRows, serial, modo).sensores) : null;
  return {
    modo,
    conexao: conexaoDaBoia({ deviceId: serial, lwt: mqtt?.lwt, ultimaMs, agoraMs, brokerConectado }),
    ultimaMs,
    valores,
    saude,
  };
}
