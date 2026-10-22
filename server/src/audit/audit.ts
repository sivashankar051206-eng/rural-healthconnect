import type { Request } from 'express';
import { pool, type Db } from '../db/pool';
import { logger } from '../utils/logger';

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILURE';

export interface AuditEvent {
  action: string;
  result: AuditResult;
  resourceType?: string;
  resourceId?: string | null;
  /** Defaults to the authenticated user of `req`. */
  actorId?: string | null;
  actorRole?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /pass|token|secret|otp|totp|cookie|authorization|^code$/i;

/** Drops any metadata key that could carry a credential. Values are shallow-copied. */
function sanitize(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
  }
  return out;
}

async function write(req: Request | null, e: AuditEvent, db: Db): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, result, ip, request_id, session_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      e.actorId !== undefined ? e.actorId : (req?.auth?.userId ?? null),
      e.actorRole !== undefined ? e.actorRole : (req?.auth?.role ?? null),
      e.action,
      e.resourceType ?? null,
      e.resourceId ?? null,
      e.result,
      req?.ip ?? null,
      req?.requestId ?? null,
      req?.auth?.sessionId ?? null,
      JSON.stringify(sanitize(e.metadata)),
    ],
  );
}

/** Best-effort audit write: failures are logged but never break the request. */
export async function audit(req: Request | null, e: AuditEvent, db: Db = pool): Promise<void> {
  try {
    await write(req, e, db);
  } catch (err) {
    logger.error({ err, action: e.action }, 'Audit log write failed');
  }
}

/**
 * Strict audit write for access to sensitive clinical data: if the access
 * cannot be recorded, the data is not returned.
 */
export async function auditStrict(req: Request | null, e: AuditEvent, db: Db = pool): Promise<void> {
  await write(req, e, db);
}
