import { describe, it, expect } from 'vitest';
import { FLEET, getMqttTopics } from '../config/fleet';
import {
  topicsForRegistry, codigoEmUso, upsertRegistryEntry,
  SEED_BUOYS, LAGOA_LABEL, MODOS, normalizeModo, withModo, motivoCodigoInvalido,
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

  it('serial fora do formato não vira tópico (não se assina MQTT com ele)', () => {
    expect(topicsForRegistry([{ codigo: 'X', deviceId: 'ab c' }, { codigo: 'Y', deviceId: 'a/#' }])).toEqual([]);
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

describe('modo (bancada/campo)', () => {
  const NOW = '2026-11-17T12:00:00.000Z';
  const base = { codigo: 'SM-01', nome: 'A', lagoa: 'mundau', lat: -9.1, lng: -35.1, deviceId: 'esp_a' };

  it('normalizeModo trata ausente/inválido como bancada', () => {
    expect(MODOS).toEqual(['bancada', 'campo']);
    expect(normalizeModo('campo')).toBe('campo');
    expect(normalizeModo('bancada')).toBe('bancada');
    expect(normalizeModo(undefined)).toBe('bancada');
    expect(normalizeModo('xyz')).toBe('bancada');
    expect(normalizeModo(null)).toBe('bancada');
  });

  it('withModo grava modoDesde só quando o modo muda', () => {
    const prev = { ...base, modo: 'bancada', modoDesde: '2026-01-01T00:00:00.000Z' };
    expect(withModo(prev, { ...base, modo: 'bancada' }, NOW))
      .toMatchObject({ modo: 'bancada', modoDesde: prev.modoDesde });
    expect(withModo(prev, { ...base, modo: 'campo' }, NOW))
      .toMatchObject({ modo: 'campo', modoDesde: NOW });
    // previous sem modo conta como bancada
    expect(withModo(base, { ...base, modo: 'bancada' }, NOW).modoDesde).toBeUndefined();
    expect(withModo(base, { ...base, modo: 'campo' }, NOW).modoDesde).toBe(NOW);
  });

  it('withModo em cadastro novo grava modo e modoDesde', () => {
    expect(withModo(null, { ...base, modo: 'campo' }, NOW))
      .toMatchObject({ modo: 'campo', modoDesde: NOW });
    expect(withModo(null, { ...base }, NOW))
      .toMatchObject({ modo: 'bancada', modoDesde: NOW });
  });
});

describe('seed SM-01 e re-export de deviceIds', () => {
  it('SM-01 usa snt-0001 com esp_sururu como anterior', () => {
    const sm01 = SEED_BUOYS.find(b => b.codigo === 'SM-01');
    expect(sm01.deviceId).toBe('snt-0001');
    expect(sm01.deviceIdsAnteriores).toEqual(['esp_sururu']);
  });
});

describe('motivoCodigoInvalido', () => {
  it('recusa nomes reservados sem diferenciar maiúsculas', () => {
    expect(motivoCodigoInvalido('FROTA')).toBe('O código "FROTA" é reservado pelo painel.');
    expect(motivoCodigoInvalido('firmware')).toBe('O código "firmware" é reservado pelo painel.');
  });
  it('recusa "/", "." e ".."', () => {
    const msg = 'O código não pode conter "/" nem ser "." ou "..".';
    for (const c of ['a/b', '.', '..']) expect(motivoCodigoInvalido(c)).toBe(msg);
  });
  it('aceita código comum', () => {
    expect(motivoCodigoInvalido('SM-01')).toBeNull();
  });
});
