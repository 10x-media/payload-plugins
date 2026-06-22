import type { Payload } from 'payload'

import { leaseExpiry } from './leaseLogic'
import type { LeaseRecord, LeaseResult, LeaseStore } from './leaseStore'
import { JOBS_LOCKS_SLUG, type LeaderRole } from './locksCollection'

type PgRow = {
	role: LeaderRole
	owner: string | null
	lease_expires_at: Date | string | null
	fence_token: number | string
}

type PgPool = {
	query: (text: string, values?: unknown[]) => Promise<{ rowCount: number; rows: PgRow[] }>
}

/** Payload tables for kebab slugs are the slug with hyphens replaced by underscores. */
const tableName = (payload: Payload): string => {
	const defaultTable = JOBS_LOCKS_SLUG.replace(/-/g, '_')
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
export const createPostgresLeaseStore = (payload: Payload): LeaseStore => {
	const table = tableName(payload)
	const db = pool(payload)

	const toRecord = (row: PgRow | undefined): LeaseRecord | null =>
		row === undefined
			? null
			: {
					fenceToken: Number(row.fence_token),
					leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
					owner: row.owner ?? null,
					role: row.role,
				}

	return {
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (role, owner, ttlMs, now)
		acquireOrSteal: async (role, owner, ttlMs, now): Promise<LeaseResult> => {
			const res = await db.query(
				`UPDATE ${table}
				 SET owner = $1, lease_expires_at = $2, fence_token = fence_token + 1
				 WHERE role = $3 AND (owner IS NULL OR lease_expires_at < $4)
				 RETURNING fence_token`,
				[owner, leaseExpiry(now, ttlMs), role, now]
			)
			return {
				fenceToken: res.rowCount === 1 ? Number(res.rows[0]?.fence_token) : 0,
				ok: res.rowCount === 1,
			}
		},
		read: async (role): Promise<LeaseRecord | null> => {
			const res = await db.query(
				`SELECT role, owner, lease_expires_at, fence_token FROM ${table} WHERE role = $1`,
				[role]
			)
			return toRecord(res.rows[0])
		},
		release: async (role, owner): Promise<{ ok: boolean }> => {
			const res = await db.query(
				`UPDATE ${table} SET owner = NULL, lease_expires_at = NULL WHERE role = $1 AND owner = $2 RETURNING role`,
				[role, owner]
			)
			return { ok: res.rowCount === 1 }
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (role, owner, ttlMs, now)
		renew: async (role, owner, ttlMs, now): Promise<LeaseResult> => {
			const res = await db.query(
				`UPDATE ${table}
				 SET lease_expires_at = $1
				 WHERE role = $2 AND owner = $3
				 RETURNING fence_token`,
				[leaseExpiry(now, ttlMs), role, owner]
			)
			return {
				fenceToken: res.rowCount === 1 ? Number(res.rows[0]?.fence_token) : 0,
				ok: res.rowCount === 1,
			}
		},
	}
}
