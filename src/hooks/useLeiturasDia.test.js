import { describe, it, expect } from 'vitest';
import { parseCountCsv } from './useLeiturasDia';

describe('parseCountCsv', () => {
  it('lê o _value do count()', () => {
    const csv = '#datatype,string,long,long\n,result,table,_value\n,_result,0,17280\n';
    expect(parseCountCsv(csv)).toBe(17280);
  });

  it('janela sem nenhuma série = 0 leituras', () => {
    expect(parseCountCsv('')).toBe(0);
    expect(parseCountCsv('\n')).toBe(0);
  });

  it('CSV sem _value ou valor inválido = null (falha, não zero)', () => {
    expect(parseCountCsv(',result,table,x\n,_result,0,1\n')).toBeNull();
    expect(parseCountCsv(',result,table,_value\n,_result,0,abc\n')).toBeNull();
  });
});
