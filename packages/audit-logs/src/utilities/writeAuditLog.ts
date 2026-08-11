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
 * Writes one entry, always with `overrideAccess`: the collection denies every operation
 * by default, and the log has to fill regardless of who is writing.
 *
 * The cast is the reason this helper exists. `user` is a polymorphic relationship when
 * the host has several auth collections and a plain one otherwise, so the generated
 * `AuditLog` type only ever matches one of the two shapes the plugin can write. Keeping
 * it here means one unchecked boundary instead of one per hook.
 */
export const writeAuditLog = async (req: PayloadRequest, data: AuditLogData): Promise<void> => {
	await req.payload.create({
		collection: 'audit-logs',
		data: data as never,
		overrideAccess: true,
		req,
	})
}
