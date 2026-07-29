import { Thermometer, Droplet, Activity } from 'lucide-react';

// Faixas saudáveis (CONAMA 357 — águas estuarinas, ajustáveis aqui).
// ideal: [min, max] verde. warning: limites amarelos. abs: extremos do eixo p/ score.
export const WATER_PARAMS = [
  { key: 'temperatura', label: 'Temperatura', unit: '°C', decimals: 1, icon: Thermometer, color: '#ff7043',
    thresholds: { ideal: [22, 30], warning: [18, 32], abs: [10, 45] } },
  { key: 'ph', label: 'pH', unit: '', decimals: 2, icon: Droplet, color: '#00f0ff',
    thresholds: { ideal: [6.5, 8.5], warning: [6.0, 9.0], abs: [0, 14] } },
  { key: 'turbidez', label: 'Turbidez', unit: 'NTU', decimals: 1, icon: Activity, color: '#b388ff',
    thresholds: { ideal: [0, 40], warning: [0, 100], abs: [0, 400] } },
];

const byKey = Object.fromEntries(WATER_PARAMS.map(p => [p.key, p]));

const TEXT = { good: 'Saudável', warning: 'Atenção', critical: 'Crítico' };
const COLOR = { good: '#22c55e', warning: '#eab308', critical: '#ef4444' };

// Classifica um valor em good | warning | critical para um parâmetro.
export function classifyParam(key, value) {
  const p = byKey[key];
  if (p == null || value == null || Number.isNaN(value)) return null;
  const { ideal, warning } = p.thresholds;
  let level;
  if (value >= ideal[0] && value <= ideal[1]) level = 'good';
  else if (value >= warning[0] && value <= warning[1]) level = 'warning';
  else level = 'critical';
  return { level, text: TEXT[level], color: COLOR[level] };
}

// Sub-score 0..100 conforme proximidade do ideal.
function subScore(key, value) {
  const p = byKey[key];
  const { ideal, warning, abs } = p.thresholds;
  if (value >= ideal[0] && value <= ideal[1]) return 100;
  const high = value > ideal[1];
  if (high) {
    if (value <= warning[1]) return 100 - 50 * (value - ideal[1]) / (warning[1] - ideal[1]);
    return Math.max(0, 50 - 50 * (value - warning[1]) / Math.max(1, abs[1] - warning[1]));
  }
  if (value >= warning[0]) return 100 - 50 * (ideal[0] - value) / (ideal[0] - warning[0]);
  return Math.max(0, 50 - 50 * (warning[0] - value) / Math.max(1, warning[0] - abs[0]));
}

// Índice de Qualidade da Água: média dos sub-scores + classificação.
export function computeWQI(reading) {
  if (!reading) return null;
  const valid = WATER_PARAMS.filter(p => reading[p.key] != null && !Number.isNaN(reading[p.key]));
  if (valid.length === 0) return null;
  const total = valid.reduce((s, p) => s + subScore(p.key, reading[p.key]), 0);
  const score = Math.round(total / valid.length);
  const level = score >= 75 ? 'BOA' : score >= 50 ? 'REGULAR' : 'RUIM';
  const color = level === 'BOA' ? '#22c55e' : level === 'REGULAR' ? '#eab308' : '#ef4444';
  return { score, level, color };
}

// min/max/avg por parâmetro a partir do histórico.
export function sessionStats(history) {
  const out = {};
  for (const p of WATER_PARAMS) {
    const vals = history.map(h => h[p.key]).filter(v => v != null && !Number.isNaN(v));
    out[p.key] = vals.length
      ? { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length }
      : null;
  }
  return out;
}

// Bins para histograma de um parâmetro.
export function histogramBins(history, key, nBins = 8) {
  const vals = history.map(h => h[key]).filter(v => v != null && !Number.isNaN(v));
  if (vals.length === 0) return [];
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const step = span / nBins;
  const bins = Array.from({ length: nBins }, (_, i) => ({ label: (min + i * step).toFixed(1), count: 0 }));
  for (const v of vals) {
    let idx = Math.floor((v - min) / step);
    if (idx >= nBins) idx = nBins - 1;
    bins[idx].count++;
  }
  return bins;
}
