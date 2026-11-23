import { useEffect, useState } from 'react';
import { getSetting, saveSetting, MOCK_MODE_KEY } from '../services/settings';

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

// ── Flag de modo simulado (global, em app_settings) ──────────
// Uma flag para todo mundo: o admin liga/desliga em Configurações e todo
// visitante passa a ver a mesma fonte. Antes ficava no localStorage de cada
// navegador, com default LIGADO — quem nunca abriu o painel via "SIMULADO".
// Default agora é DESLIGADO: sem nada salvo, ou se a leitura falhar, o site
// mostra só dado real.
const EVENT = 'sentinela:mockmodechange';

export function normalizeMockMode(value) {
  return value?.ativo === true;
}

/**
 * Resultado de uma leitura da flag -> { estado, on }. Falha de leitura é
 * 'desconhecido' (o admin não pode ver "Desligado" quando não sabe); para o
 * visitante `on` continua false (nunca mostra dado inventado sem confirmação).
 * @param {{ok: true, value: *} | {ok: false}} leitura
 */
export function estadoMockMode(leitura) {
  if (!leitura?.ok) return { estado: 'desconhecido', on: false };
  const on = normalizeMockMode(leitura.value);
  return { estado: on ? 'ligado' : 'desligado', on };
}

// Uma leitura por carregamento da página, compartilhada por todos os hooks
// (a página de monitoramento e o contador de dias usam a flag ao mesmo tempo).
// Falha não é memorizada: o próximo `recarregar` tenta de novo.
let cached = null;   // último resultado de estadoMockMode (null = ainda não leu)
let pending = null;

function loadMockMode() {
  if (!pending) {
    pending = getSetting(MOCK_MODE_KEY, { ativo: false })
      .then(value => { cached = estadoMockMode({ ok: true, value }); return cached; })
      .catch(err => {
        console.warn('mockData: falha ao ler a flag de dados simulados', err);
        pending = null;
        cached = estadoMockMode({ ok: false });
        return cached;
      });
  }
  return pending;
}

/**
 * Hook da flag: `[ligado, salvar, estado, recarregar]`. `estado` é 'carregando' |
 * 'ligado' | 'desligado' | 'desconhecido' (leitura falhou: o painel mostra
 * "estado desconhecido" e bloqueia o switch; o site público trata como desligado).
 * Começa desligado até a leitura voltar (primeiro paint nunca mostra dado
 * inventado). `salvar(on)` grava no banco (RLS: só admin) e lança erro se a
 * gravação falhar — a UI volta ao estado anterior e avisa.
 */
export function useMockMode() {
  const [leitura, setLeitura] = useState(() => cached ?? { estado: 'carregando', on: false });
  const carregar = () => loadMockMode().then(setLeitura);
  useEffect(() => {
    let ativo = true;
    loadMockMode().then(v => { if (ativo) setLeitura(v); });
    const handler = (e) => {
      const on = e.detail === true;
      setLeitura({ estado: on ? 'ligado' : 'desligado', on });
    };
    window.addEventListener(EVENT, handler);
    return () => {
      ativo = false;
      window.removeEventListener(EVENT, handler);
    };
  }, []);
  const update = async (value) => {
    const next = value === true;
    await saveSetting(MOCK_MODE_KEY, { ativo: next });
    cached = estadoMockMode({ ok: true, value: { ativo: next } });
    pending = Promise.resolve(cached);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  };
  const recarregar = () => {
    setLeitura({ estado: 'carregando', on: false });
    pending = null;
    cached = null;
    carregar();
  };
  return [leitura.on, update, leitura.estado, recarregar];
}
