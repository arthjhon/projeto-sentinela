import { describe, it, expect, vi } from 'vitest';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));

import { buildMqttConnectOptions, useMqtt } from './useMqtt';

describe('buildMqttConnectOptions', () => {
  it('connects anonymously: no username/password, keepalive 60', () => {
    const o = buildMqttConnectOptions('sentinela_web_x');
    expect(o).not.toHaveProperty('username');
    expect(o).not.toHaveProperty('password');
    expect(o.clientId).toBe('sentinela_web_x');
    expect(o.keepalive).toBe(60);
    expect(o.reconnectPeriod).toBe(5000);
  });
});

describe('useMqtt module', () => {
  it('exports the hook without a publish helper', () => {
    expect(typeof useMqtt).toBe('function');
    expect(useMqtt.toString()).not.toMatch(/publish/);
  });
});
