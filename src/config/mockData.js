import { useEffect, useState } from 'react';

// ── Geradores de dados simulados ──────────────────────────────
// Usados enquanto a bóia física ainda não está em operação.
// Random-walk em torno de valores saudáveis para parecer realista.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const walk = (v, step, lo, hi) =>
  clamp((v == null ? (lo + hi) / 2 : v) + (Math.random() - 0.5) * step, lo, hi);

// Próxima leitura de sensores a partir da anterior (continuidade suave).
export function makeMockReading(prev) {
  return {
    temperatura: +walk(prev?.temperatura, 0.6, 24, 29).toFixed(2),
    ph: +walk(prev?.ph, 0.15, 7.0, 8.4).toFixed(2),
    turbidez: +walk(prev?.turbidez, 4, 8, 55).toFixed(1),
  };
}

// Payload de status (saúde do device) simulado.
export function makeMockStatus(uptimeSeconds) {
  return {
    rssi: -50 - Math.round(Math.random() * 30),
    free_heap: 120000 + Math.round(Math.random() * 40000),
    total_heap: 320000,
    uptime: uptimeSeconds,
    mqtt_latency: 20 + Math.round(Math.random() * 60),
    firmware: 'v2.0-mock',
  };
}

// ── Flag de modo simulado (persistida em localStorage) ────────
const KEY = 'sentinela_mock_data';
const EVENT = 'sentinela:mockmodechange';

// Default: LIGADO (bóia ainda não opera). Desligar quando entrar em produção.
export function getMockMode() {
  if (typeof localStorage === 'undefined') return true;
  const v = localStorage.getItem(KEY);
  return v == null ? true : v === 'true';
}

export function setMockMode(on) {
  localStorage.setItem(KEY, String(on));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

// Hook que lê a flag e reage a mudanças (mesma aba ou outra aba).
export function useMockMode() {
  const [on, setOn] = useState(getMockMode);
  useEffect(() => {
    const handler = () => setOn(getMockMode());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);
  const update = (value) => { setMockMode(value); setOn(value); };
  return [on, update];
}
