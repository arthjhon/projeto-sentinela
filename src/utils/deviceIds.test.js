import { describe, it, expect } from 'vitest';
import { deviceIdsOf, applyDeviceIdChange, mergeRegistryEdit, normalizeDeviceIds, topicFilterFlux } from './deviceIds';

describe('deviceIdsOf', () => {
  it('atual primeiro, depois anteriores, sem duplicar', () => {
    expect(deviceIdsOf({ deviceId: 'snt-0001', deviceIdsAnteriores: ['esp_sururu', 'snt-0001', 'esp_sururu'] }))
      .toEqual(['snt-0001', 'esp_sururu']);
  });
  it('remove falsy e ids inválidos', () => {
    expect(deviceIdsOf({
      deviceId: null,
      deviceIdsAnteriores: ['', null, 'a b', 'x"y', 'a'.repeat(41), 'ok_1', 'ok-2'],
    })).toEqual(['ok_1', 'ok-2']);
  });
  it('tolera bóia ausente ou sem anteriores', () => {
    expect(deviceIdsOf(undefined)).toEqual([]);
    expect(deviceIdsOf({ deviceId: 'snt-0002' })).toEqual(['snt-0002']);
  });
});

describe('applyDeviceIdChange', () => {
  it('esp_sururu -> snt-0001 guarda o antigo', () => {
    const e = applyDeviceIdChange({ codigo: 'SM-01', deviceId: 'esp_sururu' }, 'snt-0001');
    expect(e.deviceId).toBe('snt-0001');
    expect(e.deviceIdsAnteriores).toEqual(['esp_sururu']);
  });
  it('voltar ao antigo remove da lista de anteriores e guarda o atual', () => {
    const e = applyDeviceIdChange(
      { deviceId: 'snt-0001', deviceIdsAnteriores: ['esp_sururu'] }, 'esp_sururu');
    expect(e.deviceId).toBe('esp_sururu');
    expect(e.deviceIdsAnteriores).toEqual(['snt-0001']);
  });
  it('sem mudança não altera nada', () => {
    const entry = { deviceId: 'snt-0001', deviceIdsAnteriores: ['esp_sururu'] };
    expect(applyDeviceIdChange(entry, 'snt-0001')).toEqual(entry);
  });
  it('antigo vazio não entra na lista; novo vazio (null) guarda o antigo', () => {
    expect(applyDeviceIdChange({ deviceId: null }, 'snt-0001').deviceIdsAnteriores ?? []).toEqual([]);
    const e = applyDeviceIdChange({ deviceId: 'snt-0001' }, null);
    expect(e.deviceId).toBeNull();
    expect(e.deviceIdsAnteriores).toEqual(['snt-0001']);
  });
});

describe('topicFilterFlux', () => {
  it('string única', () => {
    expect(topicFilterFlux('esp_a')).toBe('|> filter(fn: (r) => r.topic == "esp_a/sensores")');
  });
  it('união com or', () => {
    expect(topicFilterFlux(['a', 'b'])).toBe(
      '|> filter(fn: (r) => r.topic == "a/sensores" or r.topic == "b/sensores")');
  });
  it('null/undefined = sem bóia selecionada, sem filtro', () => {
    expect(topicFilterFlux(undefined)).toBe('');
    expect(topicFilterFlux(null)).toBe('');
  });
  it('bóia selecionada sem id válido falha fechado (nunca todas as bóias)', () => {
    const closed = '|> filter(fn: (r) => false)';
    expect(topicFilterFlux([])).toBe(closed);
    expect(topicFilterFlux('')).toBe(closed);
    expect(topicFilterFlux(['a"b'])).toBe(closed);
    expect(topicFilterFlux('a b')).toBe(closed);
  });
  it('normalizeDeviceIds aceita string ou array', () => {
    expect(normalizeDeviceIds('x')).toEqual(['x']);
    expect(normalizeDeviceIds(['x', 'x', 'y z'])).toEqual(['x']);
  });
});

describe('mergeRegistryEdit', () => {
  const previous = { codigo: 'SM-01', nome: 'old', lat: 1, deviceId: 'snt-0001', deviceIdsAnteriores: ['esp_sururu'] };
  it('editar nome sem mudar o serial mantém a edição e os anteriores', () => {
    const r = mergeRegistryEdit(previous, { codigo: 'SM-01', nome: 'NEW', lat: 2, deviceId: 'snt-0001' });
    expect(r).toMatchObject({ nome: 'NEW', lat: 2, deviceId: 'snt-0001', deviceIdsAnteriores: ['esp_sururu'] });
  });
  it('trocar o serial acrescenta o antigo', () => {
    const r = mergeRegistryEdit(previous, { nome: 'old', deviceId: 'snt-0002' });
    expect(r.deviceId).toBe('snt-0002');
    expect(r.deviceIdsAnteriores).toEqual(['esp_sururu', 'snt-0001']);
  });
  it('cadastro novo não tem anteriores', () => {
    const r = mergeRegistryEdit(undefined, { codigo: 'X', nome: 'n', deviceId: 'snt-0003' });
    expect(r.deviceIdsAnteriores).toBeUndefined();
    expect(r.nome).toBe('n');
  });
  it('limpar o serial (null) guarda o antigo em anteriores', () => {
    const r = mergeRegistryEdit(previous, { nome: 'old', deviceId: null });
    expect(r.deviceId).toBeNull();
    expect(r.deviceIdsAnteriores).toEqual(['esp_sururu', 'snt-0001']);
  });
});
