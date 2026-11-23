import { describe, it, expect } from 'vitest';
import {
  FIRMWARE_MIN_REINICIO, REINICIO_TIMEOUT_MS, REINICIO_FOLGA_S,
  firmwareSuportaReinicio, permissaoReinicio, estadoReinicio,
} from './reinicioRemoto';

describe('constantes', () => {
  it('valores fixos', () => {
    expect(FIRMWARE_MIN_REINICIO).toBe('5.2.0');
    expect(REINICIO_TIMEOUT_MS).toBe(180000);
    expect(REINICIO_FOLGA_S).toBe(30);
  });
});

describe('firmwareSuportaReinicio', () => {
  it.each([['5.2.0', true], ['5.2.1-teste', true], ['5.10.0', true], ['6.0.0', true],
    ['5.1.2', false], ['5.1.1-teste', false], [null, false], ['abc', false], ['5.2', false]])(
    '%s -> %s', (v, r) => expect(firmwareSuportaReinicio(v)).toBe(r));
});

describe('permissaoReinicio', () => {
  const ok = { role: 'admin', isFallback: false, serial: 'snt-0001', conexao: 'online', firmware: '5.2.0' };
  it('libera quando tudo atende', () => expect(permissaoReinicio(ok)).toEqual({ permitido: true }));
  it('visualizador = demo', () => expect(permissaoReinicio({ ...ok, role: 'visualizador' }))
    .toEqual({ permitido: false, motivo: 'Indisponível no modo demonstração.' }));
  it('operador', () => expect(permissaoReinicio({ ...ok, role: 'operador' }))
    .toEqual({ permitido: false, motivo: 'Somente administradores reiniciam a placa.' }));
  it('fallback', () => expect(permissaoReinicio({ ...ok, isFallback: true }).motivo)
    .toBe('Cadastro indisponível: ficha só leitura.'));
  it('sem serial', () => expect(permissaoReinicio({ ...ok, serial: null }).motivo)
    .toBe('Bóia sem placa cadastrada.'));
  it('offline', () => expect(permissaoReinicio({ ...ok, conexao: 'offline' }).motivo)
    .toBe('A placa precisa estar online.'));
  it('firmware desconhecido', () => expect(permissaoReinicio({ ...ok, firmware: null }).motivo)
    .toBe('Versão do firmware desconhecida.'));
  it('firmware antigo', () => expect(permissaoReinicio({ ...ok, firmware: '5.1.2' }))
    .toEqual({ permitido: false, motivo: 'Requer firmware 5.2.0 ou mais novo (placa em 5.1.2).' }));
  it('ordem: demo antes de fallback', () => expect(permissaoReinicio({ ...ok, role: 'visualizador', isFallback: true }).motivo)
    .toBe('Indisponível no modo demonstração.'));
});

describe('estadoReinicio', () => {
  const env = 1_000_000;
  const conf = { _recebidoEm: env + 20000, reset_reason: 'remote', uptime: 10 };
  it('confirmado', () => expect(estadoReinicio({ enviadoEmMs: env, agoraMs: env + 25000, statusMsg: conf })).toBe('confirmado'));
  it('status de conexão sem uptime -> aguardando', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 25000, statusMsg: { _recebidoEm: env + 20000, reset_reason: 'remote' } })).toBe('aguardando'));
  it('remote mas recebido antes do envio -> aguardando', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 25000, statusMsg: { ...conf, _recebidoEm: env - 1 } })).toBe('aguardando'));
  it('uptime maior que o tempo desde o envio + folga -> aguardando', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 25000, statusMsg: { ...conf, uptime: 56 } })).toBe('aguardando'));
  it('outro motivo -> aguardando', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 25000, statusMsg: { ...conf, reset_reason: 'poweron' } })).toBe('aguardando'));
  it('sem statusMsg -> aguardando', () => expect(estadoReinicio({ enviadoEmMs: env, agoraMs: env + 1000, statusMsg: null })).toBe('aguardando'));
  it('181 s sem confirmação', () => expect(estadoReinicio({ enviadoEmMs: env, agoraMs: env + 181000, statusMsg: null })).toBe('sem-confirmacao'));
  it('180 s exatos ainda aguardando', () => expect(estadoReinicio({ enviadoEmMs: env, agoraMs: env + 180000, statusMsg: null })).toBe('aguardando'));
  it('confirmação tardia ainda vale como confirmado', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 181000, statusMsg: { ...conf, _recebidoEm: env + 100000, uptime: 100 } })).toBe('confirmado'));
  it('remote de reinício anterior (uptime 200 s, recebido 2 s após o clique, agora 170 s) -> aguardando', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 170000,
    statusMsg: { _recebidoEm: env + 2000, reset_reason: 'remote', uptime: 200 } })).toBe('aguardando'));
  it('uptime 0 recebido após o clique -> confirmado', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 25000,
    statusMsg: { _recebidoEm: env + 20000, reset_reason: 'remote', uptime: 0 } })).toBe('confirmado'));
  it('sem _recebidoEm -> aguardando', () => expect(estadoReinicio({
    enviadoEmMs: env, agoraMs: env + 25000, statusMsg: { reset_reason: 'remote', uptime: 10 } })).toBe('aguardando'));
});
