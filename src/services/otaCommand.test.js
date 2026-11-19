import { describe, it, expect, vi } from 'vitest';
import { buildDeployRow, requestOtaCommand, otaErrorMessage } from './otaCommand';

const httpError = (status, body) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => body },
});

const makeClient = (invokeResult) => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const invoke = vi.fn().mockResolvedValue(invokeResult);
  return { client: { functions: { invoke }, from }, invoke, from, update, eq };
};

describe('buildDeployRow', () => {
  it('stores the uploaded object path as arquivo_path', () => {
    const row = buildDeployRow({
      boiaId: 'SM-01', version: 'v1', sha256: 'ab', notes: '', path: 'v1_1.bin',
    });
    expect(row).toEqual({
      boia_id: 'SM-01', versao: 'v1', sha256: 'ab', notas_release: null,
      status: 'pendente', arquivo_path: 'v1_1.bin',
    });
    expect(row.arquivo_path).toMatch(/^[A-Za-z0-9._-]+\.bin$/);
  });
});

describe('requestOtaCommand', () => {
  it('invokes ota-command with the deploy id and returns ok', async () => {
    const { client, invoke, from } = makeClient({ data: { ok: true }, error: null });
    const r = await requestOtaCommand(client, 'uuid-1');
    expect(invoke).toHaveBeenCalledWith('ota-command', { body: { deploy_id: 'uuid-1' } });
    expect(r).toEqual({ ok: true });
    expect(from).not.toHaveBeenCalled();
  });

  it('marks the deploy falha on a 4xx and reports the code', async () => {
    const { client, update, eq } = makeClient({ data: null, error: httpError(422, { error: 'bad_sha' }) });
    const r = await requestOtaCommand(client, 'uuid-1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('bad_sha');
    expect(r.message).toMatch(/SHA/i);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'falha' }));
    expect(eq).toHaveBeenCalledWith('id', 'uuid-1');
  });

  it('does not mark falha on 502 (the function already did)', async () => {
    const { client, from } = makeClient({ data: null, error: httpError(502, { error: 'broker_unavailable' }) });
    const r = await requestOtaCommand(client, 'uuid-1');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('broker_unavailable');
    expect(from).not.toHaveBeenCalled();
  });

  it('marks falha on a network error (no HTTP response)', async () => {
    const { client, update } = makeClient({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to fetch' } });
    const r = await requestOtaCommand(client, 'uuid-1');
    expect(r.ok).toBe(false);
    expect(update).toHaveBeenCalled();
  });

  it('survives an unparseable error body', async () => {
    const err = { name: 'FunctionsHttpError', context: { status: 403, json: async () => { throw new Error('x'); } } };
    const { client } = makeClient({ data: null, error: err });
    const r = await requestOtaCommand(client, 'uuid-1');
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
  });
});

describe('otaErrorMessage', () => {
  it('maps known codes to PT-BR and falls back for unknown', () => {
    for (const c of ['not_pending', 'no_device', 'bad_device', 'bad_path', 'bad_sha', 'no_version', 'broker_unavailable', 'forbidden']) {
      expect(otaErrorMessage(c)).toBeTruthy();
      expect(otaErrorMessage(c)).not.toBe(otaErrorMessage('???'));
    }
    expect(otaErrorMessage('???')).toMatch(/\?\?\?/);
  });
});
