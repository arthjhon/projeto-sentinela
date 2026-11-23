import { normalizeCollectionRadius, DEFAULT_COLLECTION_RADIUS_M } from './collectionRadius';

/**
 * Lê meta e raio das configurações. Falha de leitura vira { ok: false, erro } SEM
 * valor: a tela não preenche o formulário com um default e bloqueia o "Salvar", que
 * gravaria o default por cima do valor real. "Nada salvo ainda" não é falha: vale o
 * default do `getSetting` (ok: true).
 * @param {(key: string, fallback: *) => Promise<*>} getSetting
 */
export async function carregarConfiguracoes(getSetting, { metaKey, raioKey }) {
  const tentar = async (fn) => {
    try { return { ok: true, valor: await fn() }; } catch (err) { return { ok: false, erro: err.message }; }
  };
  const [meta, raio] = await Promise.all([
    tentar(() => getSetting(metaKey, { meta: 0, arrecadado: 0 })),
    tentar(async () => normalizeCollectionRadius(
      (await getSetting(raioKey, { raio_m: DEFAULT_COLLECTION_RADIUS_M }))?.raio_m,
    )),
  ]);
  return { meta, raio };
}
