import { describe, it, expect } from 'vitest';
import { FLEET, getMqttTopics } from '../config/fleet';
import {
  topicsForRegistry, codigoEmUso, upsertRegistryEntry, mergeRegistryIntoRows,
  SEED_BUOYS, LAGOA_LABEL,
} from './buoyRegistry';

describe('topicsForRegistry', () => {
  const buoys = [
    { codigo: 'SM-01', nome: 'A', lagoa: 'mundau', lat: -9.1, lng: -35.1, deviceId: 'esp_a' },
    { codigo: 'SM-02', nome: 'B', lagoa: 'mundau', lat: -9.2, lng: -35.2, deviceId: null },
    { codigo: 'MG-01', nome: 'C', lagoa: 'manguaba', lat: -9.3, lng: -35.3, deviceId: 'esp_c' },
  ];

  it('gera tópicos só para bóias com deviceId, um por suffix', () => {
    expect(topicsForRegistry(buoys)).toEqual([
      'esp_a/sensores', 'esp_a/status', 'esp_a/availability',
      'esp_c/sensores', 'esp_c/status', 'esp_c/availability',
    ]);
  });

  it('respeita suffixes customizados', () => {
    expect(topicsForRegistry(buoys, ['ota/status'])).toEqual([
      'esp_a/ota/status',
      'esp_c/ota/status',
    ]);
  });

  it('lista vazia gera lista de tópicos vazia', () => {
    expect(topicsForRegistry([])).toEqual([]);
  });
});

describe('codigoEmUso', () => {
  const codigos = ['SM-01', 'SM-02'];

  it('cadastro: código existente está em uso', () => {
    expect(codigoEmUso(codigos, 'SM-01')).toBe(true);
    expect(codigoEmUso(codigos, 'FIX-01')).toBe(false);
  });

  it('edição: a bóia pode manter o próprio código, mas não pegar o de outra', () => {
    expect(codigoEmUso(codigos, 'SM-02', 'SM-02')).toBe(false);
    expect(codigoEmUso(codigos, 'SM-01', 'SM-02')).toBe(true);
  });
});

describe('upsertRegistryEntry', () => {
  const list = [
    { codigo: 'SM-01', nome: 'A', deviceId: 'esp_a' },
    { codigo: 'SM-02', nome: 'B', deviceId: null },
    { codigo: 'MG-01', nome: 'C', deviceId: null },
  ];

  it('edição substitui no lugar, sem mover a bóia para o fim', () => {
    const out = upsertRegistryEntry(list, 'SM-01', { codigo: 'SM-01', nome: 'A2', deviceId: 'esp_novo' });
    expect(out.map(r => r.codigo)).toEqual(['SM-01', 'SM-02', 'MG-01']);
    expect(out[0]).toEqual({ codigo: 'SM-01', nome: 'A2', deviceId: 'esp_novo' });
  });

  it('renomear o código mantém a posição', () => {
    const out = upsertRegistryEntry(list, 'SM-02', { codigo: 'SM-03', nome: 'B', deviceId: null });
    expect(out.map(r => r.codigo)).toEqual(['SM-01', 'SM-03', 'MG-01']);
  });

  it('cadastro acrescenta ao fim', () => {
    const out = upsertRegistryEntry(list, null, { codigo: 'FIX-01', nome: 'D', deviceId: 'esp_d' });
    expect(out.map(r => r.codigo)).toEqual(['SM-01', 'SM-02', 'MG-01', 'FIX-01']);
  });

  it('edição de bóia que sumiu da lista (apagada em outra sessão) acrescenta ao fim', () => {
    const out = upsertRegistryEntry(list, 'APAGADA', { codigo: 'APAGADA', nome: 'E', deviceId: null });
    expect(out.map(r => r.codigo)).toEqual(['SM-01', 'SM-02', 'MG-01', 'APAGADA']);
  });

  it('bloqueia cadastro com código existente e renomear para código de outra bóia', () => {
    expect(() => upsertRegistryEntry(list, null, { codigo: 'SM-01', nome: 'X', deviceId: null })).toThrow(/SM-01/);
    expect(() => upsertRegistryEntry(list, 'SM-02', { codigo: 'SM-01', nome: 'B', deviceId: null })).toThrow(/SM-01/);
  });

  it('não altera a lista recebida', () => {
    upsertRegistryEntry(list, 'SM-01', { codigo: 'SM-01', nome: 'Z', deviceId: null });
    expect(list[0].nome).toBe('A');
  });
});

describe('mergeRegistryIntoRows', () => {
  const makeRow = (entry) => ({ id: entry.codigo, battery: 100, created: true });

  it('identidade vem do registro; o resto da linha local é preservado', () => {
    const rows = [{ id: 'SM-01', name: 'Local', deviceId: 'esp_velho', battery: 42 }];
    const registry = [{ codigo: 'SM-01', nome: 'Registro', deviceId: 'esp_novo' }];
    expect(mergeRegistryIntoRows(rows, registry, makeRow)).toEqual([
      { id: 'SM-01', name: 'Registro', deviceId: 'esp_novo', battery: 42 },
    ]);
  });

  it('bóia só no registro ganha linha padrão; linha fora do registro sai; ordem do registro', () => {
    const rows = [
      { id: 'APAGADA', name: 'x', deviceId: '', battery: 1 },
      { id: 'SM-01', name: 'a', deviceId: 'esp_a', battery: 50 },
    ];
    const registry = [
      { codigo: 'NOVA', nome: 'Nova', deviceId: null },
      { codigo: 'SM-01', nome: 'a', deviceId: 'esp_a' },
    ];
    expect(mergeRegistryIntoRows(rows, registry, makeRow)).toEqual([
      { id: 'NOVA', name: 'Nova', deviceId: '', battery: 100, created: true },
      { id: 'SM-01', name: 'a', deviceId: 'esp_a', battery: 50 },
    ]);
  });

  it('registro vazio esvazia a tabela', () => {
    expect(mergeRegistryIntoRows([{ id: 'SM-01' }], [], makeRow)).toEqual([]);
  });
});

describe('getMqttTopics — default de suffixes (spec: status real via availability)', () => {
  const comHardware = FLEET.filter(b => b.deviceId);

  it('inscreve sensores, status e availability de cada bóia de FLEET com hardware', () => {
    expect(comHardware.length).toBeGreaterThan(0); // não passar "vazio"
    expect(getMqttTopics()).toEqual(comHardware.flatMap(b => [
      `${b.deviceId}/sensores`, `${b.deviceId}/status`, `${b.deviceId}/availability`,
    ]));
  });

  it('mesmo default de topicsForRegistry', () => {
    expect(getMqttTopics()).toEqual(topicsForRegistry(comHardware));
  });
});

describe('SEED_BUOYS (fallback do registro)', () => {
  it('espelha FLEET: mesmo hardware e rótulo de lagoa igual ao location da bóia de mesmo código', () => {
    for (const seed of SEED_BUOYS) {
      const fleet = FLEET.find(f => f.id === seed.codigo);
      expect(fleet).toBeDefined();
      expect(seed.deviceId).toBe(fleet.deviceId ?? null);
      expect(LAGOA_LABEL[seed.lagoa]).toBe(fleet.location);
    }
  });
});
