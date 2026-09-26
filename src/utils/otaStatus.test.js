import { describe, it, expect } from 'vitest';
import { isFreshDeployEvent, phaseFromOtaStatus } from './otaStatus';

// useMqtt guarda o último payload de cada tópico e o JSON.parse cria um objeto
// novo por mensagem — por isso a identidade do objeto distingue mensagens.
const success = () => ({ status: 'success', progress: 100, firmware: 'v5.0.0', error: '' });

describe('isFreshDeployEvent', () => {
  it('ignora status retido entregue ao abrir a página (sem deploy em curso)', () => {
    expect(isFreshDeployEvent(success(), undefined, 'idle')).toBe(false);
  });

  it('ignora o mesmo payload quando o effect roda de novo por outra mensagem', () => {
    const msg = { status: 'downloading', progress: 10 };
    expect(isFreshDeployEvent(msg, msg, 'waiting')).toBe(false);
  });

  it('depois de "Novo Deploy" (idle), o success antigo não trava o formulário de novo', () => {
    const old = success();
    expect(isFreshDeployEvent(old, old, 'idle')).toBe(false);
    expect(isFreshDeployEvent(old, undefined, 'idle')).toBe(false);
  });

  it('aceita mensagem nova durante um deploy desta página', () => {
    const prev = { status: 'downloading', progress: 10 };
    const next = { status: 'downloading', progress: 20 };
    expect(isFreshDeployEvent(next, prev, 'waiting')).toBe(true);
    expect(isFreshDeployEvent(next, prev, 'sending')).toBe(true);
  });

  it('não reage fora de sending/waiting', () => {
    for (const phase of ['idle', 'uploading', 'success', 'error']) {
      expect(isFreshDeployEvent(success(), undefined, phase)).toBe(false);
    }
  });

  it('sem payload não há evento', () => {
    expect(isFreshDeployEvent(undefined, undefined, 'waiting')).toBe(false);
  });
});

describe('phaseFromOtaStatus', () => {
  it('mapeia os status publicados pelo firmware', () => {
    expect(phaseFromOtaStatus('downloading')).toBe('waiting');
    expect(phaseFromOtaStatus('flashing')).toBe('waiting');
    expect(phaseFromOtaStatus('success')).toBe('success');
    expect(phaseFromOtaStatus('error')).toBe('error');
  });

  it('status desconhecido não muda a fase', () => {
    expect(phaseFromOtaStatus('idle')).toBeNull();
    expect(phaseFromOtaStatus(undefined)).toBeNull();
  });
});
