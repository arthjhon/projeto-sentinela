// Camada de dados da página /admin/contexto: turbidez de uma bóia empilhada
// sobre chuva/vazão/nível das estações da ANA, no mesmo eixo de tempo.
import { DURACOES } from './influxQueries';
import { fetchNamed, fetchNamedPerDevice, rowsOf } from './influxql';
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
const T0_UTC = 'T03:00:00Z'; // meia-noite de Maceió (UTC-3, sem horário de verão)
const dataMaceio = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Maceio', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Atalho de N dias terminando hoje (data local de Maceió, inclusive). */
export function janelaAtalho(dias, agora) {
  const hoje = Date.parse(`${dataMaceio.format(agora)}T00:00:00Z`);
  const inicio = new Date(hoje - (dias - 1) * DIA_MS).toISOString().slice(0, 10);
  return { inicio, duracao: `${dias}d` };
}

/** [t0, t1) da janela: inicio 03:00Z até t0 + duracao (Nd). */
export function janelaIntervalo(inicio, duracao) {
  const t0 = new Date(`${inicio}${T0_UTC}`);
  const t1 = new Date(t0.getTime() + parseInt(duracao, 10) * DIA_MS);
  return { t0, t1 };
}

/** Domínio do eixo X em ms, cortado em `agora` (sem espaço vazio no futuro). */
export function dominio(inicio, duracao, agora) {
  const { t0, t1 } = janelaIntervalo(inicio, duracao);
  return [t0.getTime(), Math.min(t1.getTime(), agora.getTime())];
}

/** Tamanho do balde do GROUP BY em ms por duração ('180d' -> 6 h): primeiro token de DURACOES. */
export const PASSO_MS = Object.fromEntries(Object.entries(DURACOES).map(([duracao, every]) => {
  const [, n, unidade] = /^(\d+)([mh])/.exec(every);
  return [duracao, Number(n) * (unidade === 'h' ? 3600000 : 60000)];
}));

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
 * Executa as duas buscas em sequência (o proxy aceita 3 conexões por IP),
 * cada uma com seu próprio estado: a falha de uma não apaga a outra.
 * `emit(chave, patch)` recebe mudanças parciais de `turbidez` | `ana`.
 * Abort não é erro: retorna sem emitir.
 */
export async function carregarContexto({ deviceIds, estacao, inicio, duracao }, signal, emit) {
  const passos = [
    ['turbidez', () => fetchTurbidezJanela(deviceIds, inicio, duracao, { signal })],
    ['ana', () => fetchAna(estacao, inicio, duracao, { signal })],
  ];
  // as duas séries entram em loading já, com dados limpos: nada da janela,
  // estação ou bóia anterior pode ficar ao lado de um erro ou do novo eixo X
  emit('turbidez', { data: [], loading: true, error: null });
  emit('ana', { data: ANA_VAZIO, loading: true, error: null });
  for (const [chave, buscar] of passos) {
    try {
      emit(chave, { data: await buscar(), loading: false, error: null });
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) return;
      emit(chave, { loading: false, error: err.message });
    }
  }
}
