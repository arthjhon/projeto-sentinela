export const TIMEOUT_TAREFA_MS = 35000;

const erroAbortado = () => new DOMException('Aborted', 'AbortError');

function executar(tarefa, { signal, timeoutMs }) {
  if (signal?.aborted) return Promise.reject(erroAbortado());
  const ctrl = new AbortController();
  const repassar = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', repassar, { once: true });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const erro = new Error(`Tempo esgotado: a consulta passou de ${Math.round(timeoutMs / 1000)} s`);
      erro.name = 'TimeoutError';
      reject(erro); // antes do abort: este erro vence o AbortError do fetch
      ctrl.abort(erro);
    }, timeoutMs);
    Promise.resolve()
      .then(() => tarefa(ctrl.signal))
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', repassar);
      });
  });
}

/**
 * Fila que roda uma tarefa assíncrona por vez, na ordem de chegada. A visão
 * geral dispara várias consultas ao Influx ao abrir (últimas por bóia, mín./máx.
 * de 24 h, status) e o nginx limita 3 conexões simultâneas por IP: passando por
 * aqui, essas somam uma por vez (mais o gráfico). Falha de uma tarefa chega a
 * quem a pediu e não trava as seguintes.
 *
 * Uma tarefa que passa de `timeoutMs` (35 s) é abortada e rejeita com
 * TimeoutError, liberando a fila (uma consulta pendurada não para o resto).
 * A tarefa recebe um AbortSignal: repasse-o ao fetch. `{signal}` do chamador
 * cancela a tarefa (e, se ela ainda não começou, impede que rode).
 * @returns {<T>(tarefa: (signal: AbortSignal) => Promise<T>, opts?: {signal?: AbortSignal}) => Promise<T>}
 */
export function criarFilaSerial({ timeoutMs = TIMEOUT_TAREFA_MS } = {}) {
  let cauda = Promise.resolve();
  return (tarefa, { signal } = {}) => {
    const resultado = cauda.then(() => executar(tarefa, { signal, timeoutMs }));
    cauda = resultado.catch(() => {});
    return resultado;
  };
}
