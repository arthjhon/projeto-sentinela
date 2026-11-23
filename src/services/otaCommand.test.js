import { describe, it, expect, vi } from 'vitest';
import {
  buildDeployRow, requestOtaCommand, otaErrorMessage, ultimoDeploy,
  removeFirmwareFile, listarDeploys, deveRemoverBin,
} from './otaCommand';

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

describe('ultimoDeploy', () => {
  const makeReader = (result) => {
    const limit = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) }));
    const order = vi.fn(() => ({ limit }));
    const eq2 = vi.fn(() => ({ order }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    return { client: { from: vi.fn(() => ({ select })) }, eq1, eq2, order, limit };
  };

  it('returns the most recent successful deploy of the buoy', async () => {
    const row = { versao: 'v5.1', status: 'sucesso' };
    const r = makeReader({ data: row, error: null });
    await expect(ultimoDeploy(r.client, 'SM-01')).resolves.toEqual(row);
    expect(r.client.from).toHaveBeenCalledWith('firmware_deploys');
    expect(r.eq1).toHaveBeenCalledWith('boia_id', 'SM-01');
    expect(r.eq2).toHaveBeenCalledWith('status', 'sucesso');
    expect(r.order).toHaveBeenCalledWith('data_deploy', { ascending: false });
    expect(r.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when there is none', async () => {
    const r = makeReader({ data: null, error: null });
    await expect(ultimoDeploy(r.client, 'SM-01')).resolves.toBeNull();
  });

  it('throws on query error', async () => {
    const r = makeReader({ data: null, error: { message: 'boom' } });
    await expect(ultimoDeploy(r.client, 'SM-01')).rejects.toThrow('boom');
  });
});

describe('buildDeployRow operator', () => {
  it('records who requested the deploy when given', () => {
    const row = buildDeployRow({
      boiaId: 'SM-01', version: 'v1', sha256: 'ab', notes: '', path: 'v1_1.bin',
      operatorId: 'u1', operatorName: 'Ana',
    });
    expect(row.operador_id).toBe('u1');
    expect(row.operador_nome).toBe('Ana');
  });
});

describe('removeFirmwareFile (M6)', () => {
  it('removes the object from the firmware bucket and returns true', async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ remove }));
    const client = { storage: { from } };
    expect(await removeFirmwareFile(client, 'v1_1.bin')).toBe(true);
    expect(from).toHaveBeenCalledWith('firmware');
    expect(remove).toHaveBeenCalledWith(['v1_1.bin']);
  });
  it('never throws: returns false on error or exception, no-op without a path', async () => {
    const bad = { storage: { from: () => ({ remove: vi.fn().mockResolvedValue({ error: { message: 'x' } }) }) } };
    expect(await removeFirmwareFile(bad, 'a.bin')).toBe(false);
    const boom = { storage: { from: () => ({ remove: vi.fn().mockRejectedValue(new Error('net')) }) } };
    expect(await removeFirmwareFile(boom, 'a.bin')).toBe(false);
    expect(await removeFirmwareFile(bad, '')).toBe(false);
  });
});

describe('deveRemoverBin', () => {
  it('removes after a definite refusal, keeps it when the outcome is unknown', () => {
    expect(deveRemoverBin({ ok: false, status: 422 })).toBe(true);
    expect(deveRemoverBin({ ok: false, status: 502 })).toBe(true);
    // network error: the function may have published the command and the
    // device may still download the file.
    expect(deveRemoverBin({ ok: false, status: null })).toBe(false);
    expect(deveRemoverBin({ ok: true })).toBe(false);
  });
});

describe('listarDeploys', () => {
  const chain = (result) => {
    const limit = vi.fn().mockResolvedValue(result);
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    return { client: { from: vi.fn(() => ({ select })) }, select, order, limit };
  };
  it('reads the latest deploys, newest first', async () => {
    const rows = [{ id: '1' }];
    const { client, select, order, limit } = chain({ data: rows, error: null });
    expect(await listarDeploys(client, 10)).toEqual(rows);
    expect(select.mock.calls[0][0]).toMatch(/versao.*boia_id|boia_id.*versao/);
    expect(order).toHaveBeenCalledWith('data_deploy', { ascending: false });
    expect(limit).toHaveBeenCalledWith(10);
  });
  it('throws on error instead of returning an empty list', async () => {
    const { client } = chain({ data: null, error: { message: 'rls' } });
    await expect(listarDeploys(client)).rejects.toThrow('rls');
  });
});
