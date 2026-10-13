import type { PayloadRequest } from 'payload'

import type { AuditLogsCustom } from '../plugin/registerLogsCollection'
import { actingUserRef, impersonatorRef, userRef } from './userRef'
import { writeAuditLog } from './writeAuditLog'

export type CreateAuditEventOptions = {
	/**
	 * The collection or global slug this event relates to.
	 */
	collection: string
	/**
	 * The document this event relates to. Omit for globals or collection-level events.
	 */
	documentId?: number | string
	/**
	 * User-defined string identifying the type of custom event.
	 * @example 'score_adjustment', 'manual_override', 'compliance_review'
	 */
	eventType: string
	/**
	 * Group identifier for this log entry. When provided, takes precedence over
	 * `req.context[contextKey]`, the key `logs.group.contextKey` configures (`auditGroup` by
	 * default). Use this to associate the event with an ongoing workflow tracked by a shared
	 * group ID.
	 */
	group?: string
	/**
	 * Arbitrary data for this event. Structure is entirely up to the consumer.
	 * This is the place for business-specific audit data.
	 *
	 * @example
	 * {
	 *   reason: 'doping_disqualification',
	 *   adjustedScore: -5,
	 *   effectiveDate: '2026-02-15', // may differ from when the log was created
	 * }
	 */
	metadata?: Record<string, unknown>
	/**
	 * The tenant the event belongs to, when `multiTenancy` is configured. Without it the entry
	 * has no tenant, so only the all-tenants view lists it. Ignored with a warning when
	 * `multiTenancy` is off.
	 */
	tenant?: number | string
	/**
	 * Who the event is attributed to, when it is not `req.user`: work a person started that
	 * runs in a job, on a request without a user. Replaces `req.user` for the `user` field
	 * only; `impersonator` is still read from `req`. `collection` is the user's auth
	 * collection.
	 */
	user?: { collection: string; id: number | string }
}

/**
 * Creates a custom audit log entry. Use this for business-specific events that fall outside
 * of automatic create/update/delete tracking.
 *
 * `user` (unless `options.user` is given), `impersonator` and `locale` are auto-populated
 * from `req`. The log `createdAt` reflects when this function is called, use `metadata` to
 * record any domain-specific timestamps that differ (e.g. the date an infraction actually
 * occurred).
 *
 * @example
 * await createAuditEvent(req, {
 *   collection: 'athletes',
 *   documentId: athlete.id,
 *   eventType: 'score_adjustment',
 *   metadata: {
 *     reason: 'doping_disqualification',
 *     adjustedScore: -5,
 *     effectiveDate: '2026-02-15',
 *   },
 * })
 */
export const createAuditEvent = async (
	req: PayloadRequest,
	options: CreateAuditEventOptions
): Promise<void> => {
	const auditLogsCollection = req.payload.config.collections.find((c) => c.slug === 'audit-logs')
	const hasField = (name: string) =>
		auditLogsCollection?.fields.some((f) => 'name' in f && f.name === name) ?? false
	const impersonator = hasField('impersonator') ? impersonatorRef(req.user) : undefined

	// Group: explicit option wins; fall back to the configured context key, as the CRUD hooks do
	const groupContextKey = (auditLogsCollection?.custom?.auditLogs as AuditLogsCustom | undefined)
		?.groupContextKey
	const group =
		options.group ??
		(hasField('group') && groupContextKey
			? ((req.context as Record<string, unknown>)?.[groupContextKey] as string | undefined)
			: undefined)

	const hasTenantField = hasField('tenant')
	if (options.tenant != null && !hasTenantField) {
		req.payload.logger.warn(
			`createAuditEvent: ignoring tenant for '${options.eventType}', multiTenancy is not configured`
		)
	}

	const user = options.user
		? userRef(options.user.collection, options.user.id)
		: actingUserRef(req.user)

	await writeAuditLog({
		req,
		// One deliberate call per business event, not a per-write hot path, so it takes the
		// pipeline and any hooks an override attached fire as the host expects.
		fastWrite: false,
		data: {
			operation: 'custom',
			eventType: options.eventType,
			relationTo: options.collection,
			...(options.documentId != null && { documentId: String(options.documentId) }),
			...(user && { user }),
			...(impersonator !== undefined && { impersonator }),
			...(req.locale && { locale: req.locale }),
			payloadAPI: req.payloadAPI,
			...(options.metadata && { metadata: options.metadata }),
			...(group && { group }),
			...(options.tenant != null && hasTenantField && { tenant: options.tenant }),
		},
	})
}
