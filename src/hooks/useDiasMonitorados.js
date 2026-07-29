import { useState, useEffect, useMemo } from 'react';
import { useMockMode } from '../config/mockData';
import { FLEET } from '../config/fleet';

// "Dias monitorados" (5.3). Dois modos, conforme o toggle de dados simulados:
//
//   mock ON  → dias desde a instalação da SM-01 (fleet.js). É persistente:
//              uma âncora fixa que cresce sozinha a cada dia, sem depender do
//              banco. Coerente com o resto do mock, que roda sem hardware.
//   mock OFF → dias desde a PRIMEIRA leitura real gravada no InfluxDB.
//
// Assim, ao desligar o mock (bóia em operação), o número passa a refletir o
// dado real sem mais nenhuma mudança de código.

const ORG = import.meta.env.VITE_INFLUX_ORG;
const BUCKET = import.meta.env.VITE_INFLUX_BUCKET;

const SM01 = FLEET.find(b => b.id === 'SM-01');

const UM_DIA = 86_400_000;

/** Converte 'DD/MM/YYYY' num Date local. */
function parseDataBr(str) {
  const [d, m, y] = String(str).split('/').map(Number);
  return new Date(y, m - 1, d);
}

function diasDesde(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / UM_DIA));
}

/** Primeira leitura real gravada, via o proxy /influx (token injetado no servidor). */
async function fetchPrimeiraLeitura(signal) {
  const flux = `
from(bucket: "${BUCKET}")
  |> range(start: -3650d)
  |> filter(fn: (r) => r._measurement == "sensores")
  |> first()
  |> keep(columns: ["_time"])`;

  const res = await fetch(`/influx/api/v2/query?org=${encodeURIComponent(ORG)}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
    body: flux,
  });
  if (!res.ok) throw new Error(`Influx ${res.status}`);

  const csv = await res.text();
  const linhas = csv.trim().split('\n').filter(l => l && !l.startsWith('#'));
  if (linhas.length < 2) return null;

  const header = linhas[0].split(',').map(h => h.trim());
  const iTime = header.indexOf('_time');
  if (iTime === -1) return null;

  // first() devolve uma linha por série; a mais antiga é a que interessa
  let earliest = null;
  for (const l of linhas.slice(1)) {
    const t = new Date(l.split(',')[iTime]);
    if (!Number.isNaN(t.getTime()) && (!earliest || t < earliest)) earliest = t;
  }
  return earliest;
}

/**
 * @returns {{dias: number|null, fonte: 'mock'|'real', carregando: boolean}}
 */
export function useDiasMonitorados() {
  const [mock] = useMockMode();
  const [real, setReal] = useState(null);

  // mock é síncrono e estável — memoizado para não recalcular a cada render
  const diasMock = useMemo(() => diasDesde(parseDataBr(SM01?.installedAt)), []);

  useEffect(() => {
    if (mock) return;            // em modo mock não toca no Influx
    const ctrl = new AbortController();
    (async () => {
      try {
        const primeira = await fetchPrimeiraLeitura(ctrl.signal);
        setReal(diasDesde(primeira));
      } catch (err) {
        if (err.name !== 'AbortError') setReal(null);
      }
    })();
    return () => ctrl.abort();
  }, [mock]);

  return mock
    ? { dias: diasMock, fonte: 'mock', carregando: false }
    : { dias: real, fonte: 'real', carregando: real === null };
}
