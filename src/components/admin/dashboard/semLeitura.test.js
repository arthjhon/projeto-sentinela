// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rotuloSemLeitura } from './semLeitura';

// instantes UTC: Maceió = UTC-3 (sem horário de verão), independente do fuso do CI
const agora = Date.UTC(2026, 10, 22, 18, 0); // 15:00 de 22/11 em Maceió

describe('rotuloSemLeitura', () => {
  it('sem última leitura: só "sem leitura" (nunca inventa hora)', () => {
    expect(rotuloSemLeitura(null, agora)).toBe('sem leitura');
    expect(rotuloSemLeitura(undefined, agora)).toBe('sem leitura');
    expect(rotuloSemLeitura(NaN, agora)).toBe('sem leitura');
  });
  it('mesmo dia em Maceió: "sem leitura desde HH:MM"', () => {
    expect(rotuloSemLeitura(Date.UTC(2026, 10, 22, 12, 5), agora)).toBe('sem leitura desde 09:05');
  });
  it('outro dia: com a data, para HH:MM não parecer de hoje', () => {
    expect(rotuloSemLeitura(Date.UTC(2026, 9, 3, 17, 32), agora)).toBe('sem leitura desde 03/10 às 14:32');
  });
  it('virada de dia vale em Maceió, não em UTC', () => {
    const agoraNoite = Date.UTC(2026, 10, 23, 2, 0); // 23:00 de 22/11 em Maceió
    expect(rotuloSemLeitura(Date.UTC(2026, 10, 23, 1, 0), agoraNoite)).toBe('sem leitura desde 22:00');
  });
});
