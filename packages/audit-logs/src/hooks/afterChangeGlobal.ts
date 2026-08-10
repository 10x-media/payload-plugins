import type { GlobalAfterChangeHook } from 'payload'

import type { AnonymizeFunction, ShouldLogFunction } from '../types'
import { REDACTED } from '../types'
import type { FieldMap } from '../utilities/buildFieldMap'
import { computeDiff } from '../utilities/diff'
import { getClientIP, getUserAgent } from '../utilities/request'
import { extractTenantId } from '../utilities/tenant'

export type AuditLogGlobalAfterChangeOptions = {
	anonymize?: AnonymizeFunction
	collectIpAddress: boolean
	collectUserAgent: boolean
	drafts: 'ignore' | 'log'
	excludeFields?: string[]
	fieldMap?: FieldMap
	globalSlug: string
	groupContextKey?: string
	isUserPolymorphic: boolean
	shouldLog?: ShouldLogFunction
	tenantFieldName?: string
}

const applyAnonymization = (
	diff: Record<string, { after: unknown; before: unknown }>,
	globalSlug: string,
	anonymize: AnonymizeFunction
): Record<string, { after: unknown; before: unknown }> => {
	const result: Record<string, { after: unknown; before: unknown }> = {}

	for (const [path, { before, after }] of Object.entries(diff)) {
		result[path] = {
			before: anonymize({
				path,
				value: before,
				collection: globalSlug,
				documentId: '',
				operation: 'update',
				redacted: REDACTED,
			}),
			after: anonymize({
				path,
				value: after,
				collection: globalSlug,
				documentId: '',
				operation: 'update',
				redacted: REDACTED,
			}),
		}
	}

	return result
}

export const afterChangeGlobalAuditLog =
	(options: AuditLogGlobalAfterChangeOptions): GlobalAfterChangeHook =>
	async ({ req, doc, previousDoc }) => {
		if (options.drafts === 'ignore' && doc._status === 'draft') return

		if (
			options.drafts === 'ignore' &&
			doc._status === 'published' &&
			previousDoc?._status === 'draft'
		) {
			const prevVersionResult = await req.payload.findGlobalVersions({
				slug: options.globalSlug,
				where: {
					and: [
						{ 'version._status': { equals: 'published' } },
						{ updatedAt: { less_than: doc.updatedAt } },
					],
				},
				sort: '-updatedAt',
				limit: 1,
				depth: 0,
				overrideAccess: true,
			})
			previousDoc = (prevVersionResult.docs[0]?.version ?? null) as typeof previousDoc
		}

		const userValue = req.user
			? options.isUserPolymorphic
				? { relationTo: req.user.collection, value: req.user.id }
				: req.user.id
			: undefined
		const ipAddress = options.collectIpAddress ? getClientIP(req) : undefined
		const userAgent = options.collectUserAgent ? getUserAgent(req) : undefined
		const group = options.groupContextKey
			? ((req.context as Record<string, unknown>)?.[options.groupContextKey] as string | undefined)
			: undefined
		const tenantValue = options.tenantFieldName
			? extractTenantId((doc as Record<string, unknown>)[options.tenantFieldName])
			: undefined
		const { changedPaths, diff } = computeDiff(
			previousDoc as Record<string, unknown>,
			doc as Record<string, unknown>,
			options.excludeFields,
			options.fieldMap
		)

		if (changedPaths.length === 0) return

		if (options.shouldLog) {
			const allow = await options.shouldLog({
				req,
				operation: 'update',
				doc: doc as Record<string, unknown>,
				previousDoc: previousDoc as Record<string, unknown>,
				diff,
				changedPaths,
			})
			if (!allow) return
		}

		const finalDiff = options.anonymize
			? applyAnonymization(diff, options.globalSlug, options.anonymize)
			: diff

		await req.payload.create({
			collection: 'audit-logs',
			data: {
				operation: 'update',
				relationTo: '__global__',
				documentId: options.globalSlug,
				...(userValue !== undefined && { user: userValue }),
				...(req.locale && { locale: req.locale }),
				payloadAPI: req.payloadAPI,
				...(ipAddress && { ipAddress }),
				...(userAgent && { userAgent }),
				changedPaths,
				diff: finalDiff,
				...(tenantValue != null && { tenant: tenantValue }),
				...(group && { group }),
			},
			overrideAccess: true,
		})
	}
