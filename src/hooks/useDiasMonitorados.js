import { useState, useEffect, useMemo } from 'react';
import { useMockMode } from '../config/mockData';
import { FLEET } from '../config/fleet';
import { fetchNamed, rowsOf } from '../services/influxql';

// "Dias monitorados" (5.3). Dois modos, conforme o toggle de dados simulados:
//
//   mock ON  → dias desde a instalação da SM-01 (fleet.js). É persistente:
//              uma âncora fixa que cresce sozinha a cada dia, sem depender do
//              banco. Coerente com o resto do mock, que roda sem hardware.
//   mock OFF → dias desde a PRIMEIRA leitura real gravada no InfluxDB.
//
// Assim, ao desligar o mock (bóia em operação), o número passa a refletir o
// dado real sem mais nenhuma mudança de código.

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

/** Data da leitura mais antiga em uma série de first() ([time, first]); null se vazia. */
export function parsePrimeira(series) {
  let earliest = null;
  for (const row of rowsOf(series)) {
    const t = new Date(row.time);
    if (!Number.isNaN(t.getTime()) && (!earliest || t < earliest)) earliest = t;
  }
  return earliest;
}

/** Primeira leitura real gravada, via a consulta nomeada /influx/q/primeira. */
async function fetchPrimeiraLeitura(signal) {
  return parsePrimeira(await fetchNamed('primeira', {}, { signal }));
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
