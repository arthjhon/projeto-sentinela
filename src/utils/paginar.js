// Fatia `lista` em paginas de `porPagina` itens; `pagina` e limitada a [1, totalPaginas].
export function paginar(lista, pagina, porPagina = 25) {
  const itens = Array.isArray(lista) ? lista : [];
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
  const n = Math.trunc(Number(pagina));
  const atual = Number.isFinite(n) ? Math.min(Math.max(n, 1), totalPaginas) : 1;
  const inicio = (atual - 1) * porPagina;
  return { itens: itens.slice(inicio, inicio + porPagina), pagina: atual, totalPaginas };
}
