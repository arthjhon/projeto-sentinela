// Agregações puras do painel de clima (visão geral). Sem React, sem I/O.
// Maceió fica em UTC−3 fixo (sem horário de verão). Dado ausente é null, nunca 0.

/** Soma diária prevista a partir da qual o painel mostra o aviso de chuva forte. */
export const LIMITE_CHUVA_FORTE_MM = 20;

const HORA_MS = 3600000;
const DIA_MS = 24 * HORA_MS;
const OFFSET_LOCAL_MS = -3 * HORA_MS;
const MIN_DIAS_MEDIANA = 7;
const FATOR_ACIMA = 1.5;
const FATOR_ABAIXO = 0.5;
const DEFASAGEM_MAX_MS = 3 * HORA_MS;

const CAMPOS_PADRAO = {
  chuva: 'precipitation',
  prob: 'precipitation_probability',
  temp: 'temperature_2m',
  vento: 'wind_speed_10m',
  nuvens: 'cloud_cover',
};

const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ehLista = (s) => (Array.isArray(s) ? s : []);

/** 'YYYY-MM-DD' do dia local de Maceió para um instante em ms. */
function diaLocal(ms) {
  return new Date(ms + OFFSET_LOCAL_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' de hoje em Maceió (UTC−3) para o instante `agoraMs`. */
export function hojeLocal(agoraMs) {
  return diaLocal(agoraMs);
}

/** 'HH:MM' em Maceió (UTC−3); null sem instante válido. */
export function horaLocal(ms) {
  const t = numero(ms);
  return t === null ? null : new Date(t + OFFSET_LOCAL_MS).toISOString().slice(11, 16);
}

const soma = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);
const max = (xs) => (xs.length ? Math.max(...xs) : null);
const min = (xs) => (xs.length ? Math.min(...xs) : null);
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Agrega a série horária por dia local de Maceió. `campos` (opcional) renomeia
 * os campos lidos: { chuva, prob, temp, vento, nuvens }. Dia sem valor válido
 * num campo fica com null nele.
 */
export function diasLocais(serie, campos = {}) {
  const c = { ...CAMPOS_PADRAO, ...campos };
  const porDia = new Map();
  for (const p of ehLista(serie)) {
    const t = numero(p?.time);
    if (t === null) continue;
    const dia = diaLocal(t);
    if (!porDia.has(dia)) porDia.set(dia, { chuva: [], prob: [], temp: [], vento: [], nuvens: [] });
    const acc = porDia.get(dia);
    for (const k of Object.keys(acc)) {
      const v = numero(p[c[k]]);
      if (v !== null) acc[k].push(v);
    }
  }
  return [...porDia.keys()].sort().map((dia) => {
    const a = porDia.get(dia);
    return {
      dia,
      chuva_mm: soma(a.chuva),
      prob_max: max(a.prob),
      temp_min: min(a.temp),
      temp_max: max(a.temp),
      vento_max: max(a.vento),
      nuvens_media: media(a.nuvens),
    };
  });
}

function somaJanela(serie, campo, deMs, ateMs) {
  const vals = [];
  for (const p of ehLista(serie)) {
    const t = numero(p?.time);
    const v = numero(p?.[campo]);
    if (t !== null && v !== null && t > deMs && t <= ateMs) vals.push(v);
  }
  return soma(vals);
}

/** Chuva prevista (soma de `precipitation`) em (agora, agora+horas]; null sem dado. */
export function acumuladoProximas(serie, agoraMs, horas) {
  return somaJanela(serie, 'precipitation', agoraMs, agoraMs + horas * HORA_MS);
}

/** Chuva medida (soma de `chuva`) em (agora-horas, agora]; null sem dado. */
export function acumuladoUltimas(serieChuva, agoraMs, horas) {
  return somaJanela(serieChuva, 'chuva', agoraMs - horas * HORA_MS, agoraMs);
}

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Vazão mais recente vs. mediana da série (30 d). Com menos de 7 dias de dado
 * a mediana não é calculada e `classe` fica null.
 */
export function classificarVazao(serieVazao) {
  const validos = ehLista(serieVazao)
    .map((p) => ({ time: numero(p?.time), vazao: numero(p?.vazao) }))
    .filter((p) => p.time !== null && p.vazao !== null);
  if (!validos.length) return { atual: null, hora: null, mediana: null, classe: null };
  const ultimo = validos.reduce((a, b) => (b.time > a.time ? b : a));
  const base = { atual: ultimo.vazao, hora: ultimo.time };
  const dias = new Set(validos.map((p) => diaLocal(p.time)));
  if (dias.size < MIN_DIAS_MEDIANA) return { ...base, mediana: null, classe: null };
  const med = mediana(validos.map((p) => p.vazao));
  let classe = 'normal';
  if (base.atual > FATOR_ACIMA * med) classe = 'acima';
  else if (base.atual < FATOR_ABAIXO * med) classe = 'abaixo';
  return { ...base, mediana: med, classe };
}

/**
 * Maior soma diária >= limite entre hoje e os 2 dias seguintes, em qualquer ponto.
 * `diasPorPonto`: { [ponto]: saída de diasLocais }; `hojeLocal`: 'YYYY-MM-DD'.
 */
export function avisoChuvaForte(diasPorPonto, hojeLocal) {
  const t0 = Date.parse(`${hojeLocal}T00:00:00Z`);
  if (!Number.isFinite(t0) || !diasPorPonto || typeof diasPorPonto !== 'object') return null;
  const janela = new Set([0, 1, 2].map((i) => new Date(t0 + i * DIA_MS).toISOString().slice(0, 10)));
  let melhor = null;
  for (const [ponto, dias] of Object.entries(diasPorPonto)) {
    for (const d of ehLista(dias)) {
      const mm = numero(d?.chuva_mm);
      if (mm === null || mm < LIMITE_CHUVA_FORTE_MM || !janela.has(d.dia)) continue;
      if (!melhor || mm > melhor.mm) melhor = { ponto, dia: d.dia, mm };
    }
  }
  return melhor;
}

/** 'ok' até 3 h de defasagem; acima disso 'desatualizada'; sem coleta 'sem dado'. */
export function frescor(ultimaColetaMs, agoraMs) {
  const t = numero(ultimaColetaMs);
  if (t === null) return 'sem dado';
  return agoraMs - t > DEFASAGEM_MAX_MS ? 'desatualizada' : 'ok';
}
