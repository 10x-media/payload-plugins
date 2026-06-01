import type { Payload } from 'payload'
import type {
	DeadLetterArgs,
	JobLeaseResult,
	JobLeaseRow,
	JobLeaseStore,
	StampResult,
} from './jobLeaseStore'
import { leaseExpiry } from './leaseLogic'

const JOBS_SLUG = 'payload-jobs'

type PgRow = {
	processing?: boolean
	lease_expires_at?: Date | string | null
	claimed_by?: string | null
	fence_token?: number | string
	recovery_attempts?: number | string
	updated_at?: Date | string
}

type PgPool = {
	query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: PgRow[] }>
}

/** Payload tables for kebab slugs are the slug with hyphens replaced by underscores. */
const tableName = (payload: Payload): string => {
	const defaultTable = JOBS_SLUG.replace(/-/g, '_')
	const map = (payload.db as unknown as { tableNameMap?: Map<string, string> }).tableNameMap
	const fromMap = map && typeof map.get === 'function' ? map.get(defaultTable) : undefined
	return fromMap ?? defaultTable
}

const pool = (payload: Payload): PgPool => {
	const found = (payload.db as unknown as { pool?: PgPool }).pool
	if (!found) {
		throw new Error(`@10x-media/jobs: missing pg pool on the "${payload.db.name}" adapter`)
	}
	return found
}

/** Single-statement `UPDATE ... WHERE <guard> RETURNING` is atomic under READ COMMITTED. */
export const createPostgresJobLeaseStore = (payload: Payload): JobLeaseStore => {
	const table = tableName(payload)
	const db = pool(payload)

	// Shared stale-orphan guard fragment. $2 = now, $3 = updatedAt cutoff. A raw UPDATE
	// here does not bump updated_at (the column has no onUpdate), unlike Mongoose which
	// auto-bumps it. That divergence never reaches this guard: a stamped row always has a
	// non-null lease (so the IS NULL fallback branch skips it), and a reclaimed row has
	// processing = false, so the fallback only ever evaluates Payload-written rows.
	const staleGuard =
		'processing = true AND has_error IS NOT TRUE AND (lease_expires_at < $2 OR (lease_expires_at IS NULL AND updated_at < $3))'

	return {
		deadLetter: async ({
			error,
			fallbackMs,
			jobId,
			now,
		}: DeadLetterArgs): Promise<JobLeaseResult> => {
			const res = await db.query(
				`UPDATE ${table}
				 SET processing = false, has_error = true, error = $4::jsonb,
				     lease_expires_at = NULL, claimed_by = NULL, fence_token = COALESCE(fence_token, 0) + 1
				 WHERE id = $1 AND ${staleGuard}
				 RETURNING id`,
				[jobId, now, new Date(now.getTime() - fallbackMs), JSON.stringify(error)]
			)
			return { ok: res.rowCount === 1 }
		},
		read: async (jobId): Promise<JobLeaseRow | null> => {
			const res = await db.query(
				`SELECT processing, lease_expires_at, claimed_by, fence_token, recovery_attempts, updated_at
				 FROM ${table} WHERE id = $1`,
				[jobId]
			)
			const row = res.rows[0]
			if (row === undefined) {
				return null
			}
			return {
				claimedBy: row.claimed_by ?? null,
				fenceToken: Number(row.fence_token ?? 0),
				leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
				processing: row.processing === true,
				recoveryAttempts: Number(row.recovery_attempts ?? 0),
				updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(0),
			}
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (jobId, fenceToken, ttlMs, now)
		renew: async (jobId, fenceToken, ttlMs, now): Promise<JobLeaseResult> => {
			const res = await db.query(
				`UPDATE ${table} SET lease_expires_at = $1
				 WHERE id = $2 AND fence_token = $3
				 RETURNING id`,
				[leaseExpiry(now, ttlMs), jobId, fenceToken]
			)
			return { ok: res.rowCount === 1 }
		},
		releaseAllClaims: async (owner): Promise<{ released: number }> => {
			const res = await db.query(
				`UPDATE ${table}
				 SET processing = false, claimed_by = NULL, lease_expires_at = NULL, wait_until = NULL,
				     recovery_attempts = COALESCE(recovery_attempts, 0) + 1,
				     fence_token = COALESCE(fence_token, 0) + 1
				 WHERE claimed_by = $1 AND processing = true
				 RETURNING id`,
				[owner]
			)
			return { released: res.rowCount ?? 0 }
		},
		requeue: async (jobId, now, fallbackMs): Promise<JobLeaseResult> => {
			const res = await db.query(
				`UPDATE ${table}
				 SET processing = false, lease_expires_at = NULL, claimed_by = NULL, wait_until = NULL,
				     recovery_attempts = COALESCE(recovery_attempts, 0) + 1,
				     fence_token = COALESCE(fence_token, 0) + 1
				 WHERE id = $1 AND ${staleGuard}
				 RETURNING id`,
				[jobId, now, new Date(now.getTime() - fallbackMs)]
			)
			return { ok: res.rowCount === 1 }
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (jobId, owner, ttlMs, now)
		stampClaim: async (jobId, owner, ttlMs, now): Promise<StampResult> => {
			const res = await db.query(
				`UPDATE ${table}
				 SET started_at = $1, claimed_by = $2, lease_expires_at = $3,
				     fence_token = COALESCE(fence_token, 0) + 1
				 WHERE id = $4 AND processing = true
				 RETURNING fence_token`,
				[now, owner, leaseExpiry(now, ttlMs), jobId]
			)
			const ok = res.rowCount === 1
			return { fenceToken: ok ? Number(res.rows[0]?.fence_token) : 0, ok }
		},
	}
}
