import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { sha256Bytes, sha256Hex } from './sha256';

const enc = new TextEncoder();

describe('sha256Bytes — vetores oficiais (FIPS 180-4 / NIST)', () => {
  it('string vazia', () => {
    expect(sha256Bytes(enc.encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc"', () => {
    expect(sha256Bytes(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('bloco de 448 bits (força um bloco extra de padding)', () => {
    expect(sha256Bytes(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('896 bits (dois blocos)', () => {
    expect(sha256Bytes(enc.encode(
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'))).toBe(
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1');
  });

  it('um milhão de "a" (vetor clássico do NIST)', () => {
    expect(sha256Bytes(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('sha256Bytes — bate com a implementação nativa do Node', () => {
  it('confere em 40 entradas aleatórias de tamanhos variados', () => {
    // tamanhos ao redor das fronteiras de bloco (55/56/63/64/119/120) onde o
    // padding costuma quebrar em implementações caseiras
    const tamanhos = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4096];
    for (const t of tamanhos) {
      const buf = randomBytes(t);
      const esperado = createHash('sha256').update(buf).digest('hex');
      expect(sha256Bytes(new Uint8Array(buf)), `tamanho ${t}`).toBe(esperado);
    }
  });
});

describe('sha256Hex — caminho usado pelo OtaPage', () => {
  it('aceita Blob e devolve 64 caracteres hex', async () => {
    const blob = new Blob([enc.encode('firmware falso')]);
    const hex = await sha256Hex(blob);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(createHash('sha256').update('firmware falso').digest('hex'));
  });

  it('um byte alterado muda o hash (é isso que o firmware vai detectar)', async () => {
    const bom = await sha256Hex(new Blob([new Uint8Array([1, 2, 3, 4])]));
    const ruim = await sha256Hex(new Blob([new Uint8Array([1, 2, 3, 5])]));
    expect(ruim).not.toBe(bom);
  });
});
