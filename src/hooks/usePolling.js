import { useEffect, useRef } from 'react';
import { createPoller } from '../utils/poller';

/**
 * Executa `fn` já e depois a cada `ms`, só com a aba visível (e de novo ao
 * voltar a ficar visível), sem sobrepor rodadas. Limpa tudo ao desmontar ou
 * quando `ms`/`deps` mudam (a rodada nova começa na hora).
 *
 * `fn({ signal, isCurrent })`: `isCurrent()` vira false depois da limpeza —
 * confira antes de aplicar a resposta no estado; `signal` é abortado na limpeza.
 * `fn` pode mudar a cada render sem reiniciar o polling (só `ms`/`deps` reiniciam).
 *
 * @param {(ctx: {signal: AbortSignal, isCurrent: () => boolean}) => Promise<void>|void} fn
 * @param {number} ms
 * @param {unknown[]} [deps]
 * @returns {{ runNow: () => void }} força uma rodada (ex.: botão "Atualizar"), respeitando a guarda de sobreposição
 */
export function usePolling(fn, ms, deps = []) {
  const fnRef = useRef(fn);
  const pollerRef = useRef(null);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    const poller = createPoller((ctx) => fnRef.current(ctx), ms);
    pollerRef.current = poller;
    poller.start();
    return () => { poller.stop(); pollerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);

  return { runNow: () => pollerRef.current?.runNow() };
}
