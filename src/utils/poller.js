import { createPollGuard } from './pollGuard';

// Polling com visibilidade e guarda de sobreposição, sem React (testável).
// usePolling (hooks/usePolling.js) é só a casca que liga isto ao ciclo do React.

const ambienteDoNavegador = {
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  onVisibility: (fn) => {
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  },
};

/**
 * @param {(ctx: {signal: AbortSignal, isCurrent: () => boolean}) => Promise<void>|void} fn
 *   rodada de busca. `isCurrent()` fica false depois de stop(): descarte a resposta.
 *   `signal` é abortado em stop() (passe a fetchs que aceitem).
 * @param {number} ms  intervalo
 * @param {{isVisible, onVisibility}} [env]  injetável nos testes
 * @returns {{start(): void, stop(): void, runNow(): void}}
 *   start(): roda já e depois a cada `ms`, só com a aba visível; ao voltar a ficar
 *   visível roda de novo. Nunca duas rodadas ao mesmo tempo. Erro de uma rodada é
 *   logado e não derruba o laço.
 */
export function createPoller(fn, ms, env = ambienteDoNavegador) {
  const guard = createPollGuard();
  let timer = null;
  let removeVis = null;
  let ctrl = null;

  const run = () => {
    if (!ctrl) return;
    const token = guard.start();
    if (token === null) return; // rodada anterior ainda em andamento
    const mine = ctrl;
    const ctx = { signal: mine.signal, isCurrent: () => !mine.signal.aborted && guard.isLatest(token) };
    Promise.resolve()
      .then(() => fn(ctx))
      .catch((e) => { console.error('usePolling: rodada falhou', e); })
      .finally(() => guard.finish());
  };

  return {
    start() {
      if (ctrl) return;
      ctrl = new AbortController();
      removeVis = env.onVisibility(() => { if (env.isVisible()) run(); });
      timer = setInterval(() => { if (env.isVisible()) run(); }, ms);
      run();
    },
    stop() {
      if (!ctrl) return;
      ctrl.abort();
      ctrl = null;
      clearInterval(timer);
      timer = null;
      removeVis?.();
      removeVis = null;
    },
    runNow: run,
  };
}
