// Pure rules for admin-delete-user. No Deno/npm imports, so vitest can import
// it. index.ts does the I/O (auth, profiles lookup, auth.admin.deleteUser).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** UUIDs compare case-insensitively; always compare the lower-case form. */
export function normalizeUuid(v: string): string {
  return v.toLowerCase();
}

export interface DeleteContext {
  callerId: string;
  targetId: string;
  /** profiles.role of the target; null when the auth user has no profile (orphan). */
  targetRole: string | null;
  /** count of profiles with role='admin' (orphans without a profile do not count). */
  adminCount: number;
}

export type DeleteDecision = { ok: true } | { ok: false; status: number; error: string };

export function checkDelete(ctx: DeleteContext): DeleteDecision {
  if (normalizeUuid(ctx.callerId) === normalizeUuid(ctx.targetId)) {
    return { ok: false, status: 400, error: 'Você não pode excluir a própria conta.' };
  }
  if (ctx.targetRole === 'admin' && ctx.adminCount <= 1) {
    return { ok: false, status: 409, error: 'Não é possível excluir o último administrador.' };
  }
  return { ok: true };
}
