import type { PayloadRequest } from 'payload'

/** The fields the plugin writes onto an `audit-logs` document. */
export type AuditLogData = {
	operation: 'auth' | 'create' | 'custom' | 'delete' | 'update'
	relationTo: string
	documentId?: string
	eventType?: string
	user?: unknown
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
 * Writes one entry, always threading `req` so the write joins the transaction of the
 * operation that triggered it. Without it Postgres takes a second connection and waits
 * on a lock the caller holds.
 *
 * Two paths. The direct one skips Payload's operation pipeline: there is nothing to
 * validate, since the plugin assembles the data itself, and access is overridden anyway.
 * It is only safe while the log collection carries no hooks, which is why the caller
 * decides. The adapters still shape the data, default the timestamps, and fill the side
 * tables Postgres keeps for `changedPaths` and the user relationship.
 *
 * The cast is unavoidable. `user` is a polymorphic relationship when the host has several
 * auth collections and a plain one otherwise, so the generated `AuditLog` type only ever
 * matches one of the two shapes the plugin can write.
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
	if (fastWrite) {
		await req.payload.db.create({
			collection: 'audit-logs',
			data: data as never,
			req,
			returning: false,
		})
		return
	}

	await req.payload.create({
		collection: 'audit-logs',
		data: data as never,
		overrideAccess: true,
		req,
	})
}
