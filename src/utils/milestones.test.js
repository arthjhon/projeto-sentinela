import { describe, it, expect } from 'vitest';
import { diasDesde, marcosDeDias } from './milestones';

describe('diasDesde', () => {
  it('mesmo dia da âncora → 0', () => {
    expect(diasDesde('2024-01-01', new Date('2024-01-01T00:00:00'))).toBe(0);
  });

  it('um dia depois → 1', () => {
    expect(diasDesde('2024-01-01', new Date('2024-01-02T00:00:00'))).toBe(1);
  });

  it('sem data-âncora → null', () => {
    expect(diasDesde(null)).toBe(null);
    expect(diasDesde(undefined)).toBe(null);
    expect(diasDesde('')).toBe(null);
  });
});

describe('marcosDeDias', () => {
  it('inclui o marco de 100 dias exatamente na data certa', () => {
    // 2024 é bissexto: Jan(31)+Fev(29)+Mar(31)=91 dias até 1º/abr; +9 = 10/abr
    const marcos = marcosDeDias('2024-01-01', new Date('2024-04-10T00:00:00'));
    expect(marcos).toEqual([
      { data: '2024-04-10', categoria: 'Marco', titulo: '100 dias de monitoramento', auto: true },
    ]);
  });

  it('não retorna marcos futuros (1 dia após o início)', () => {
    expect(marcosDeDias('2026-01-01', new Date('2026-01-02T00:00:00'))).toEqual([]);
  });

  it('marca o aniversário de 1 ano por calendário, não por múltiplo de 365', () => {
    // 2023-05-12 → 2024-05-12 são 366 dias corridos (2024 é bissexto), mas o
    // aniversário é o mesmo dia/mês no ano seguinte, não day+365.
    const marcos = marcosDeDias('2023-05-12', new Date('2024-05-12T00:00:00'));
    expect(marcos).toContainEqual({
      data: '2024-05-12', categoria: 'Marco', titulo: '1 ano de monitoramento', auto: true,
    });
  });

  it('sem data-âncora → lista vazia', () => {
    expect(marcosDeDias(null)).toEqual([]);
    expect(marcosDeDias(undefined)).toEqual([]);
  });

  it('marcos vêm ordenados por data crescente e com o formato esperado', () => {
    const marcos = marcosDeDias('2015-01-01', new Date('2026-07-20T00:00:00'));
    expect(marcos.length).toBeGreaterThan(5);
    for (const m of marcos) {
      expect(m.auto).toBe(true);
      expect(m.categoria).toBe('Marco');
      expect(m.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (let i = 1; i < marcos.length; i++) {
      expect(marcos[i].data >= marcos[i - 1].data).toBe(true);
    }
  });
});
