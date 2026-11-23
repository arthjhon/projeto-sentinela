// Camada de dados da página /admin/contexto: turbidez de uma bóia empilhada
// sobre chuva/vazão/nível das estações da ANA, no mesmo eixo de tempo.
import { DURACOES, INICIO_RE, T0_UTC } from './influxQueries';
import { fetchNamed, fetchNamedPerDevice, rowsOf } from './influxql';
import { hojeMaceio } from '../utils/dataMaceio';
import { mapHistorySeries, mergeHistorySeries } from '../hooks/useInfluxHistory';

export const ESTACOES_LABEL = {
  '39770000': 'Fazenda Boa Fortuna',
  '39760000': 'Murici',
  '39740000': 'União dos Palmares',
  '39700000': 'Santana do Mundaú',
  '39800100': 'Maceió-Hidro',
};
// Maceió-Hidro (39800100) ainda não devolve dados
export const ESTACOES_COM_DADOS = ['39770000', '39760000', '39740000', '39700000'];
export const ESTACAO_PADRAO = '39770000';

const DIA_MS = 24 * 60 * 60 * 1000;
const horaFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Maceio', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Data local de Maceió (YYYY-MM-DD): utils/dataMaceio.js (compartilhada com o changelog).
export { hojeMaceio };

/** "HH:MM" do instante em Maceió (rótulo "atualizado às"). */
export function horaMaceio(agora) {
  return horaFmt.format(agora);
}

/**
 * Faz o "agora" da janela avançar: devolve a mesma janela (mesma referência, sem
 * nova busca) enquanto o corte tem menos de `minMs`; senão uma janela nova com o
 * `agora` dado. Nunca anda para trás.
 */
export function janelaAtualizada(janela, agora, minMs) {
  return agora.getTime() - janela.agora.getTime() >= minMs ? { ...janela, agora } : janela;
}

/** A busca só começa com o cadastro de bóias carregado (senão sairia com deviceIds vazio) e janela completa. */
export function podeBuscar({ registroCarregado, estacao, inicio, duracao }) {
  return Boolean(registroCarregado && estacao && inicio && duracao);
}

/**
 * `inicio` digitado vale só se casa com INICIO_RE (o mesmo do nginx) e é uma data
 * real do calendário: 2026-02-31 não volta igual de um Date e é recusado.
 */
export function inicioValido(valor) {
  if (typeof valor !== 'string' || !INICIO_RE.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** Atalho de N dias terminando hoje (data local de Maceió, inclusive). */
export function janelaAtalho(dias, agora) {
  const hoje = Date.parse(`${hojeMaceio(agora)}T00:00:00Z`);
  const inicio = new Date(hoje - (dias - 1) * DIA_MS).toISOString().slice(0, 10);
  return { inicio, duracao: `${dias}d` };
}

/** [t0, t1) da janela: inicio 03:00Z até t0 + duracao (Nd). */
export function janelaIntervalo(inicio, duracao) {
  const t0 = new Date(`${inicio}${T0_UTC}`);
  const t1 = new Date(t0.getTime() + parseInt(duracao, 10) * DIA_MS);
  return { t0, t1 };
}

/**
 * Domínio do eixo X em ms, cortado em `agora` (sem espaço vazio no futuro).
 * Janela que começa depois de `agora` não tem corte possível: fica [t0, t1]
 * (nunca um domínio invertido) e a página mostra "Sem dados neste período".
 */
export function dominio(inicio, duracao, agora) {
  const { t0, t1 } = janelaIntervalo(inicio, duracao);
  const fim = Math.min(t1.getTime(), agora.getTime());
  return fim > t0.getTime() ? [t0.getTime(), fim] : [t0.getTime(), t1.getTime()];
}

/** Tamanho do balde do GROUP BY em ms por duração ('180d' -> 6 h): primeiro token de DURACOES. */
export const PASSO_MS = Object.fromEntries(Object.entries(DURACOES).map(([duracao, every]) => {
  const [, n, unidade] = /^(\d+)([mh])/.exec(every);
  return [duracao, Number(n) * (unidade === 'h' ? 3600000 : 60000)];
}));

/** Rótulo do balde para o título da chuva: 900000 -> '15 min', 3600000 -> '1 h'. */
export function rotuloPasso(passoMs) {
  return passoMs < 3600000 ? `${passoMs / 60000} min` : `${passoMs / 3600000} h`;
}

/**
 * Cursor compartilhado: índice da linha de `rows` ([{t, v}], ordenadas) mais
 * próxima de `alvo` (ms), a no máximo `passoMs`. Linhas com `v` nulo (lacunas
 * sintéticas de comLacunas, chuva sem leitura) nunca são escolhidas.
 * Sem linha a até um balde: -1 (o gráfico fica sem cursor).
 */
export function indiceMaisProximo(rows, alvo, passoMs) {
  if (!Number.isFinite(alvo)) return -1;
  let melhor = -1;
  let dist = Infinity;
  rows.forEach((r, i) => {
    if (r.v == null) return;
    const d = Math.abs(r.t - alvo);
    if (d <= passoMs && d < dist) { melhor = i; dist = d; }
  });
  return melhor;
}

/**
 * Faixas sem leitura de chuva dentro de `[d0, d1]` (ms): cada leitura cobre
 * [t, t + passoMs); o que nenhuma leitura cobre (buraco maior que um balde
 * entre linhas, linha com chuva nula, início ou fim da janela sem linha) vira
 * uma faixa [início, fim]. Separa "sem leitura" de "seco" (chuva 0).
 */
export function intervalosSemLeitura(points, passoMs, [d0, d1]) {
  if (!(Number.isFinite(d0) && Number.isFinite(d1) && d1 > d0)) return [];
  const tempos = points.filter(p => p.value != null).map(p => p.time.getTime()).sort((a, b) => a - b);
  const out = [];
  let coberto = d0;
  for (const t of tempos) {
    if (t >= d1) break;
    if (t > coberto) out.push([coberto, t]);
    coberto = Math.max(coberto, t + passoMs);
  }
  if (coberto < d1) out.push([coberto, d1]);
  return out;
}

/**
 * Ordena e insere um ponto `value: null` logo após cada ponto seguido de um
 * buraco maior que `passoMs` (estritamente), para a linha quebrar em vez de
 * ligar duas leituras distantes como se houvesse medição no meio.
 */
export function comLacunas(points, passoMs) {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const out = [];
  sorted.forEach((p, i) => {
    out.push(p);
    const next = sorted[i + 1];
    if (next && next.time - p.time > passoMs) {
      out.push({ time: new Date(p.time.getTime() + passoMs), value: null });
    }
  });
  return out;
}

/** Série de ana -> { chuva, vazao, nivel }; sem leitura = ponto com value null (lacuna, nunca 0). */
export function mapAnaSeries(series) {
  const out = { chuva: [], vazao: [], nivel: [] };
  for (const row of rowsOf(series)) {
    const time = new Date(row.time);
    for (const campo of Object.keys(out)) {
      const n = row[campo] == null ? NaN : Number(row[campo]);
      out[campo].push({ time, value: Number.isNaN(n) ? null : n });
    }
  }
  for (const campo of Object.keys(out)) out[campo].sort((a, b) => a.time - b.time);
  return out;
}

/** Chuva/vazão/nível de uma estação; estação sem dados = listas vazias. Erros do Influx rejeitam. */
export async function fetchAna(estacao, inicio, duracao, { signal } = {}) {
  return mapAnaSeries(await fetchNamed('ana', { estacao, inicio, duracao }, { signal }));
}

/**
 * Turbidez média da bóia na janela, unindo os seriais. `deviceIds` é sempre
 * array: [] ou só ids inválidos = [] sem consulta (nunca a frota).
 */
export async function fetchTurbidezJanela(deviceIds, inicio, duracao, { signal } = {}) {
  const perId = await fetchNamedPerDevice(
    'turbidez-janela', { inicio, duracao }, Array.isArray(deviceIds) ? deviceIds : [], { signal },
  );
  if (perId.length === 0) return [];
  return mergeHistorySeries(perId.map(mapHistorySeries));
}

export const ANA_VAZIO = { chuva: [], vazao: [], nivel: [] };

/**
 * Executa as duas buscas em paralelo (2 conexões; o proxy aceita 3 por IP), cada
 * uma com seu próprio estado: a falha de uma não apaga a outra.
 * `emit(chave, patch)` recebe mudanças parciais de `turbidez` | `ana`.
 * Abort não é erro: retorna sem emitir.
 * `opcoes.manterDados`: não limpa os dados ao começar (renovação da mesma janela).
 */
export async function carregarContexto({ deviceIds, estacao, inicio, duracao }, signal, emit, { manterDados = false } = {}) {
  const passos = [
    ['turbidez', () => fetchTurbidezJanela(deviceIds, inicio, duracao, { signal })],
    ['ana', () => fetchAna(estacao, inicio, duracao, { signal })],
  ];
  // as duas séries entram em loading já, com dados limpos: nada da janela,
  // estação ou bóia anterior pode ficar ao lado de um erro ou do novo eixo X
  // Com `manterDados` (renovação periódica da mesma janela) os dados anteriores seguem
  // visíveis enquanto recarrega: só a primeira carga mostra "Carregando…".
  emit('turbidez', manterDados ? { loading: true, error: null } : { data: [], loading: true, error: null });
  emit('ana', manterDados ? { loading: true, error: null } : { data: ANA_VAZIO, loading: true, error: null });
  await Promise.all(passos.map(async ([chave, buscar]) => {
    try {
      const data = await buscar();
      if (!signal?.aborted) emit(chave, { data, loading: false, error: null });
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) return;
      emit(chave, { loading: false, error: err.message });
    }
  }));
}
