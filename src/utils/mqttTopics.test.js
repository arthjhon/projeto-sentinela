import { describe, it, expect } from 'vitest';
import { newTopicsOnly } from './mqttTopics';

describe('newTopicsOnly', () => {
  it('devolve todos os candidatos quando nenhum é conhecido', () => {
    const known = new Set();
    expect(newTopicsOnly(known, ['a/1', 'b/2'])).toEqual(['a/1', 'b/2']);
  });

  it('filtra os candidatos que já estão no conjunto conhecido', () => {
    const known = new Set(['a/1', 'c/3']);
    expect(newTopicsOnly(known, ['a/1', 'b/2', 'c/3'])).toEqual(['b/2']);
  });

  it('remove duplicatas internas dos candidatos, mantendo a ordem', () => {
    const known = new Set(['a/1']);
    expect(newTopicsOnly(known, ['b/2', 'a/1', 'b/2', 'c/3', 'c/3'])).toEqual(['b/2', 'c/3']);
  });
});
