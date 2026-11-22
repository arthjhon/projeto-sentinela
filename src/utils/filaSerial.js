/**
 * Fila que roda uma tarefa assíncrona por vez, na ordem de chegada. A visão
 * geral dispara várias consultas ao Influx ao abrir (últimas por bóia, mín./máx.
 * de 24 h, status) e o nginx limita 3 conexões simultâneas por IP: passando por
 * aqui, essas somam uma por vez (mais o gráfico). Falha de uma tarefa chega a
 * quem a pediu e não trava as seguintes.
 * @returns {<T>(tarefa: () => Promise<T>) => Promise<T>}
 */
export function criarFilaSerial() {
  let cauda = Promise.resolve();
  return (tarefa) => {
    const resultado = cauda.then(() => tarefa());
    cauda = resultado.catch(() => {});
    return resultado;
  };
}
