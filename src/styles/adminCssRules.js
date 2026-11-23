// Regras de CSS do painel admin (Onda 2, "slim"): tamanhos e raios só pelos
// tokens de src/index.css, nada da cor muda reprovada em contraste nem do
// amarelo duplicado, e backdrop-filter só em AdminLayout.css (blur da sidebar;
// a topbar e os cartões do conteúdo o zeram ali) e em Modal.css.
// Módulo puro: os testes leem os arquivos e chamam verificarCssAdmin.

const CORES_PROIBIDAS = ['#64748b', '#eab308'];
const BLUR_PERMITIDO = ['AdminLayout.css', 'Modal.css'];

// Troca cada comentário por espaços, mantendo as quebras de linha (números de
// linha das violações continuam batendo com o arquivo).
const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));

const linhaDe = (css, indice) => css.slice(0, indice).split('\n').length;

// Declarações `prop: valor` (até `;` ou `}`), com a propriedade exata.
const declaracoes = (css, prop) =>
  [...css.matchAll(new RegExp(`(?<![\\w-])${prop}\\s*:\\s*([^;}]*)`, 'gi'))].map((m) => ({
    indice: m.index,
    valor: m[1].trim(),
  }));

/** Violações das regras de CSS do admin em `conteudo`; lista vazia = ok. */
export function verificarCssAdmin(conteudo, nome) {
  const css = semComentarios(conteudo);
  const violacoes = [];
  const add = (indice, msg) => violacoes.push({ indice, msg: `${nome}:${linhaDe(css, indice)}: ${msg}` });

  for (const cor of CORES_PROIBIDAS) {
    for (const m of css.matchAll(new RegExp(cor, 'gi'))) add(m.index, `cor ${m[0]} proibida (use um token)`);
  }
  for (const { indice, valor } of declaracoes(css, 'font-size')) {
    if (!/^var\(--fs-[\w-]+\)$/.test(valor) && valor !== 'inherit') add(indice, `font-size: ${valor} (use var(--fs-*) ou inherit)`);
  }
  for (const { indice, valor } of declaracoes(css, 'border-radius')) {
    if (!/^var\(--radius-[\w-]+\)$/.test(valor) && valor !== '50%' && valor !== '0') add(indice, `border-radius: ${valor} (use var(--radius-*), 50% ou 0)`);
  }
  if (!BLUR_PERMITIDO.some((arq) => nome.endsWith(arq))) {
    for (const m of css.matchAll(/backdrop-filter\s*:/gi)) add(m.index, 'backdrop-filter fora de AdminLayout.css (sidebar) e Modal.css');
  }

  return violacoes.sort((a, b) => a.indice - b.indice).map((v) => v.msg);
}
