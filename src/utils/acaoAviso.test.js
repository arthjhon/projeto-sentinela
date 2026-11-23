import { describe, it, expect } from 'vitest';
import { motivosAviso, MOTIVO_DEMO } from './acaoAviso';

describe('motivosAviso', () => {
  it('junta os motivos sem repetir, ignorando vazios', () => {
    expect(motivosAviso(['a.', undefined, 'b.', 'a.', '', null])).toBe('a. b.');
  });
  it('nenhum motivo = undefined (o aviso não aparece e aria-describedby fica de fora)', () => {
    expect(motivosAviso([])).toBeUndefined();
    expect(motivosAviso([undefined, false])).toBeUndefined();
  });
  it('texto da conta demo é único para todas as telas', () => {
    expect(MOTIVO_DEMO).toBe('Indisponível no modo demonstração.');
    expect(motivosAviso([MOTIVO_DEMO, MOTIVO_DEMO])).toBe(MOTIVO_DEMO);
  });
});
