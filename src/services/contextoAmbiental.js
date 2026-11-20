// Camada de dados da página /admin/contexto: turbidez de uma bóia empilhada
// sobre chuva/vazão/nível das estações da ANA, no mesmo eixo de tempo.
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
export const ESTACOES_COM_DADOS = Object.keys(ESTACOES_LABEL).slice(0, 4);
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
  for (const [chave, buscar] of passos) {
    emit(chave, { loading: true, error: null });
    try {
      emit(chave, { data: await buscar(), loading: false, error: null });
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) return;
      emit(chave, { loading: false, error: err.message });
    }
  }
}
