/**
 * Filtra, de uma lista de tópicos candidatos, os que ainda não estão no
 * conjunto de tópicos conhecidos — preservando a ordem e removendo
 * duplicatas internas de `candidates`. Função pura, sem efeitos colaterais,
 * para uso em `addTopics` (useMqtt) sem depender de estado do hook.
 *
 * @param {Set<string>} known - tópicos já subscritos/registrados.
 * @param {string[]} candidates - tópicos candidatos a serem adicionados.
 * @returns {string[]} candidatos que não estão em `known`, sem duplicatas.
 */
export function newTopicsOnly(known, candidates) {
  const result = [];
  const seen = new Set();
  for (const topic of candidates) {
    if (known.has(topic) || seen.has(topic)) continue;
    seen.add(topic);
    result.push(topic);
  }
  return result;
}
