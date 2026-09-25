import { describe, it, expect } from 'vitest';
import { topicsForRegistry } from './buoyRegistry';

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
