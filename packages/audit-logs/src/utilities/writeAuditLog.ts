import type { PayloadRequest } from 'payload'

import type { AuditLogsCustom } from '../plugin/registerLogsCollection'
import type { UserRef } from './userRef'

/** The fields the plugin writes onto an `audit-logs` document. */
export type AuditLogData = {
	operation: 'auth' | 'create' | 'custom' | 'delete' | 'update'
	relationTo: string
	documentId?: string
	eventType?: string
	user?: UserRef
	impersonator?: UserRef
	locale?: string
	payloadAPI?: string
	ipAddress?: string
	userAgent?: string
	changedPaths?: string[]
	diff?: Record<string, { after: unknown; before: unknown }>
	snapshot?: Record<string, unknown>
	metadata?: Record<string, unknown>
	group?: string
	tenant?: number | string
}

/**
 * Every field the plugin owns, whether or not a given entry sets it. `logs.extend` may
 * add fields but never one of these, so it cannot rewrite who acted or what changed.
 */
const BUILT_IN_FIELDS: ReadonlySet<string> = new Set([
	'archivedAt',
	'changedPaths',
	'createdAt',
	'diff',
	'documentId',
	'eventType',
	'group',
	'id',
	'impersonator',
	'ipAddress',
	'locale',
	'metadata',
	'operation',
	'payloadAPI',
	'relationTo',
	'snapshot',
	'tenant',
	'updatedAt',
	'user',
	'userAgent',
] satisfies (keyof AuditLogData | 'archivedAt' | 'createdAt' | 'id' | 'updatedAt')[])

/** `data` plus whatever `logs.extend` adds, built-in keys excepted. */
const extendData = async (data: AuditLogData, req: PayloadRequest): Promise<AuditLogData> => {
	const custom = req.payload.collections['audit-logs']?.config.custom?.auditLogs as
		| AuditLogsCustom
		| undefined
	if (!custom?.extend) return data
	const extra = await custom.extend({ data, req })
	if (!extra) return data
	const added = Object.fromEntries(
		Object.entries(extra).filter(([key]) => !BUILT_IN_FIELDS.has(key))
	)
	return { ...added, ...data }
}

/**
 * Writes one entry, always threading `req` so the write joins the transaction of the
 * operation that triggered it. Without it Postgres takes a second connection and waits
 * on a lock the caller holds.
 *
 * Two paths. The direct one skips Payload's operation pipeline: there is nothing to
 * validate, since the plugin assembles the data itself, and access is overridden anyway.
 * It is only safe while the log collection carries no hooks, which is why the caller
 * decides. The adapters still shape the data, default the timestamps, and fill the side
 * tables Postgres keeps for `changedPaths` and any hasMany field `logs.extend` fills.
 *
 * The cast is unavoidable: the plugin cannot name the host's generated `AuditLog` type.
 */
export const writeAuditLog = async ({
	data,
	fastWrite,
	req,
}: {
	data: AuditLogData
	/** False once `logs.override` attaches hooks, which a direct write would skip. */
	fastWrite: boolean
	req: PayloadRequest
}): Promise<void> => {
	const finalData = await extendData(data, req)

	if (fastWrite) {
		await req.payload.db.create({
			collection: 'audit-logs',
			data: finalData as never,
			req,
			returning: false,
		})
		return
	}

	await req.payload.create({
		collection: 'audit-logs',
		data: finalData as never,
		overrideAccess: true,
		req,
	})
}
