// Pure validation + message building for the OTA command. No Deno/npm imports,
// so vitest can import it. index.ts does the I/O (auth, DB, MQTT).

export type OtaCommandCode =
  | 'not_pending'
  | 'no_device'
  | 'bad_device'
  | 'bad_path'
  | 'bad_sha'
  | 'no_version';

export class OtaCommandError extends Error {
  code: OtaCommandCode;
  constructor(code: OtaCommandCode) {
    super(code);
    this.name = 'OtaCommandError';
    this.code = code;
  }
}

export interface OtaDeploy {
  status: string;
  versao: string;
  sha256: string;
  arquivo_path: string | null;
  device_id: string | null;
}

const DEVICE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PATH_RE = /^[A-Za-z0-9._-]+\.bin$/;
const SHA_RE = /^[0-9a-fA-F]{64}$/;

export function buildOtaCommand(
  deploy: OtaDeploy,
  publicBase: string,
): { topic: string; payload: string } {
  if (deploy.status !== 'pendente') throw new OtaCommandError('not_pending');
  if (!deploy.device_id) throw new OtaCommandError('no_device');
  if (!DEVICE_RE.test(deploy.device_id)) throw new OtaCommandError('bad_device');
  if (typeof deploy.arquivo_path !== 'string' || !PATH_RE.test(deploy.arquivo_path)) {
    throw new OtaCommandError('bad_path');
  }
  if (typeof deploy.sha256 !== 'string' || !SHA_RE.test(deploy.sha256)) {
    throw new OtaCommandError('bad_sha');
  }
  if (typeof deploy.versao !== 'string' || deploy.versao.trim() === '') {
    throw new OtaCommandError('no_version');
  }

  const base = publicBase.replace(/\/+$/, '');
  return {
    topic: `${deploy.device_id}/ota/command`,
    payload: JSON.stringify({
      url: `${base}/storage/v1/object/public/firmware/${deploy.arquivo_path}`,
      version: deploy.versao,
      sha256: deploy.sha256,
    }),
  };
}
