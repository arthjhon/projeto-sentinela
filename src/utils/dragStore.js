// Estado do arrasto de zoom dos gráficos do Contexto fora do React: mover o mouse
// notifica só quem assinou um recorte (o gráfico arrastado), em vez de re-renderizar
// a página e os quatro gráficos a cada pixel. Compatível com useSyncExternalStore.

export function createDragStore() {
  let estado = null; // { id, a, b } | null; objeto novo a cada mudança
  const ouvintes = new Set();
  const set = (novo) => { estado = novo; ouvintes.forEach((fn) => fn()); };
  return {
    getSnapshot: () => estado,
    subscribe(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    start: (id, x) => set({ id, a: x, b: null }),
    move(id, x) { if (estado && estado.id === id && estado.b !== x) set({ ...estado, b: x }); },
    /** Termina o arrasto; devolve [min, max] se houve deslocamento, senão null. */
    end() {
      const d = estado;
      if (d) set(null);
      return d && d.a != null && d.b != null && d.a !== d.b ? [Math.min(d.a, d.b), Math.max(d.a, d.b)] : null;
    },
    cancel() { if (estado) set(null); },
  };
}
