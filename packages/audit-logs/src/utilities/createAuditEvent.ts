import type { PayloadRequest } from 'payload'

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
	 * Group identifier for this log entry. When provided, takes precedence over `req.context.auditGroup`.
	 * Use this to associate the event with an ongoing workflow tracked by a shared group ID.
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
}

/**
 * Creates a custom audit log entry. Use this for business-specific events that fall outside
 * of automatic create/update/delete tracking.
 *
 * `user` and `locale` are auto-populated from `req`. The log `createdAt` reflects
 * when this function is called, use `metadata` to record any domain-specific timestamps
 * that differ (e.g. the date an infraction actually occurred).
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
	const userField = auditLogsCollection?.fields.find((f) => 'name' in f && f.name === 'user')
	const isPolymorphic = Array.isArray(
		userField && 'relationTo' in userField ? userField.relationTo : undefined
	)
	const hasGroupField = auditLogsCollection?.fields.some((f) => 'name' in f && f.name === 'group')

	// Group: explicit option wins; fall back to req.context.auditGroup if group field is enabled
	const group =
		options.group ??
		(hasGroupField
			? ((req.context as Record<string, unknown>)?.auditGroup as string | undefined)
			: undefined)

	await writeAuditLog(req, {
		operation: 'custom',
		eventType: options.eventType,
		relationTo: options.collection,
		...(options.documentId != null && { documentId: String(options.documentId) }),
		...(req.user && {
			user: isPolymorphic ? { relationTo: req.user.collection, value: req.user.id } : req.user.id,
		}),
		...(req.locale && { locale: req.locale }),
		payloadAPI: req.payloadAPI,
		...(options.metadata && { metadata: options.metadata }),
		...(group && { group }),
	})
}
