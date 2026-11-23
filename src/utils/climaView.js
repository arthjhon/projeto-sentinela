import {
  diasLocais, acumuladoProximas, acumuladoUltimas, classificarVazao, avisoChuvaForte, frescor,
  hojeLocal, horaLocal,
} from './clima';

// Modelo da seção "Clima e aporte" da visão geral: junta as buscas (previsão por
// ponto, ANA recente) e o job do worker num objeto pronto para desenhar. Puro:
// toda conta de dia/hora local vem de utils/clima.js. Falta de dado = null /
// "sem dado", nunca 0.

/** Job do worker que grava a previsão (worker_jobs.job). */
export const JOB_PREVISAO = 'openmeteo';

export const ROTULO_PONTO = { celmm: 'lagoa (CELMM)', bacia_mundau: 'bacia do Mundaú' };

const ROTULO_CLASSE = { acima: 'acima do normal', normal: 'normal', abaixo: 'abaixo do normal' };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIA_MS = 86400000;
const MAX_DIAS = 7; // hoje + 6: a previsão de 168 h cobre 7 dias locais (o último, parcial)

const finito = (v) => typeof v === 'number' && Number.isFinite(v);

/** Número com `casas` decimais e unidade (pt-BR); ausente = "sem dado". */
export function formatNum(v, casas, unidade) {
  if (!finito(v)) return 'sem dado';
  const n = v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return unidade ? `${n} ${unidade}` : n;
}

/** Rótulo de eixo em pt-BR: até 2 casas, sem zeros sobrando. */
export const formatTick = (v) => (finito(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '');

/** Chuva em mm, uma casa; ausente = "sem dado". */
export const formatMm = (v) => formatNum(v, 1, 'mm');

const ddmm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "Hoje", "Amanhã" ou "qua 25/11" para um dia 'YYYY-MM-DD' (dia local). */
export function rotuloDia(dia, hoje) {
  const t = Date.parse(`${dia}T12:00:00Z`);
  const t0 = Date.parse(`${hoje}T12:00:00Z`);
  const delta = Math.round((t - t0) / DIA_MS);
  if (delta === 0) return 'Hoje';
  if (delta === 1) return 'Amanhã';
  return `${SEMANA[new Date(t).getUTCDay()]} ${ddmm(dia)}`;
}

/** "hoje às 11:05" ou "21/11 às 22:00" (hora de Maceió); null sem instante. */
export function quandoLocal(ms, agoraMs) {
  const hora = horaLocal(ms);
  if (hora === null) return null;
  const dia = hojeLocal(ms);
  return dia === hojeLocal(agoraMs) ? `hoje às ${hora}` : `${ddmm(dia)} às ${hora}`;
}

/**
 * Estado de uma busca `{dados, erro, carregando}` (undefined = ainda não começou).
 * Dado anterior continua valendo enquanto recarrega ou se a nova busca falhar.
 * `seletor` escolhe a lista dentro de `dados` (ex.: ana.chuva).
 */
export function estadoBusca(busca, seletor = (d) => d) {
  if (!busca || (busca.dados == null && busca.carregando)) return 'carregando';
  if (busca.dados == null) return 'erro';
  const lista = seletor(busca.dados);
  return Array.isArray(lista) && lista.length ? 'ok' : 'vazio';
}

const listaDe = (busca, seletor = (d) => d) => {
  const l = busca?.dados == null ? null : seletor(busca.dados);
  return Array.isArray(l) ? l : [];
};

function ultimoInstante(serie, campo) {
  let t = null;
  for (const p of serie) if (finito(p?.time) && finito(p?.[campo]) && (t === null || p.time > t)) t = p.time;
  return t;
}

function modeloLagoa(busca, hoje) {
  const estado = estadoBusca(busca);
  const serie = listaDe(busca);
  const horasPorDia = new Map();
  for (const p of serie) {
    if (!finito(p?.time)) continue;
    const dia = hojeLocal(p.time);
    horasPorDia.set(dia, (horasPorDia.get(dia) ?? 0) + 1);
  }
  const dias = diasLocais(serie)
    .filter((d) => d.dia >= hoje)
    .slice(0, MAX_DIAS)
    .map((d) => {
      const horas = horasPorDia.get(d.dia) ?? 0;
      return { ...d, rotulo: rotuloDia(d.dia, hoje), horas, parcial: horas < 24 };
    });
  const horas = serie
    .filter((p) => finito(p?.time) && hojeLocal(p.time) === hoje)
    .sort((a, b) => a.time - b.time)
    .map((p) => ({
      time: p.time,
      hora: horaLocal(p.time),
      chuva: p.precipitation ?? null,
      prob: p.precipitation_probability ?? null,
      temp: p.temperature_2m ?? null,
      vento: p.wind_speed_10m ?? null,
    }));
  return { estado, erro: busca?.erro ?? null, dias, horas };
}

function modeloColeta(jobs, agoraMs) {
  if (jobs === undefined) return { estado: 'carregando', ms: null, quando: null, falhou: false };
  const job = (jobs ?? []).find((j) => j.job === JOB_PREVISAO);
  const t = job?.ultimo_sucesso ? Date.parse(job.ultimo_sucesso) : NaN;
  const ms = Number.isFinite(t) ? t : null;
  return { estado: frescor(ms, agoraMs), ms, quando: quandoLocal(ms, agoraMs), falhou: job?.ok === false };
}

/**
 * @param {object} p
 * @param {{dados: object[]|null, erro: string|null, carregando: boolean}|undefined} p.lagoa  previsão celmm
 * @param {{dados: object[]|null, erro: string|null, carregando: boolean}|undefined} p.bacia  previsão bacia_mundau
 * @param {{dados: {chuva: object[], vazao: object[]}|null, erro: string|null, carregando: boolean}|undefined} p.ana
 * @param {object[]|null|undefined} p.jobs  worker_jobs (undefined = carregando, null = leitura falhou)
 * @param {number} p.agoraMs
 */
export function modeloClima({ lagoa, bacia, ana, jobs, agoraMs }) {
  const hoje = hojeLocal(agoraMs);
  const mLagoa = modeloLagoa(lagoa, hoje);

  const estadoBacia = estadoBusca(bacia);
  const serieBacia = listaDe(bacia);
  const pontos = { celmm: { estado: mLagoa.estado, serie: listaDe(lagoa) }, bacia_mundau: { estado: estadoBacia, serie: serieBacia } };
  const diasPorPonto = {};
  for (const [ponto, { estado, serie }] of Object.entries(pontos)) if (estado === 'ok') diasPorPonto[ponto] = diasLocais(serie);
  const forte = avisoChuvaForte(diasPorPonto, hoje);
  const aviso = forte && { ...forte, rotuloPonto: ROTULO_PONTO[forte.ponto], rotuloDia: rotuloDia(forte.dia, hoje) };
  const avisoSemPonto = Object.entries(pontos)
    .filter(([, { estado }]) => estado === 'erro' || estado === 'vazio')
    .map(([ponto]) => ROTULO_PONTO[ponto]);

  const chuva = listaDe(ana, (d) => d.chuva);
  const ultimaChuva = ultimoInstante(chuva, 'chuva');
  const vazao = classificarVazao(listaDe(ana, (d) => d.vazao));
  const erroAna = ana?.erro ?? null;

  return {
    hoje,
    aviso,
    avisoSemPonto,
    coleta: modeloColeta(jobs, agoraMs),
    lagoa: mLagoa,
    bacia: {
      previsto: {
        estado: estadoBacia,
        erro: bacia?.erro ?? null,
        h24: acumuladoProximas(serieBacia, agoraMs, 24),
        h48: acumuladoProximas(serieBacia, agoraMs, 48),
        h72: acumuladoProximas(serieBacia, agoraMs, 72),
      },
      medido: {
        estado: estadoBusca(ana, (d) => d.chuva),
        erro: erroAna,
        h24: acumuladoUltimas(chuva, agoraMs, 24),
        h72: acumuladoUltimas(chuva, agoraMs, 72),
        ultimaMs: ultimaChuva,
        quando: quandoLocal(ultimaChuva, agoraMs),
        frescor: frescor(ultimaChuva, agoraMs),
      },
    },
    rio: {
      estado: estadoBusca(ana, (d) => d.vazao),
      erro: erroAna,
      ...vazao,
      rotuloClasse: vazao.classe ? ROTULO_CLASSE[vazao.classe] : null,
      quando: quandoLocal(vazao.hora, agoraMs),
      frescor: frescor(vazao.hora, agoraMs),
    },
  };
}
