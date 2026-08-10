import type { CollectionAfterDeleteHook } from 'payload'

import type { AnonymizeFunction, ShouldLogFunction } from '../types'
import { anonymizeDoc } from '../utilities/anonymize'
import type { FieldMap } from '../utilities/buildFieldMap'
import { normalizeSnapshot } from '../utilities/diff'
import { getClientIP, getUserAgent } from '../utilities/request'
import { extractTenantId } from '../utilities/tenant'

export type AuditLogAfterDeleteOptions = {
	anonymize?: AnonymizeFunction
	collectionSlug: string
	collectIpAddress: boolean
	collectUserAgent: boolean
	fieldMap?: FieldMap
	groupContextKey?: string
	isUserPolymorphic: boolean
	isSelfTenant?: boolean
	shouldLog?: ShouldLogFunction
	snapshotOnDelete: boolean
	tenantFieldName?: string
}

export const afterDeleteCollectionAuditLog =
	(options: AuditLogAfterDeleteOptions): CollectionAfterDeleteHook =>
	async ({ req, id, doc }) => {
		const documentId = String(id)
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
		const tenantValue = options.isSelfTenant
			? extractTenantId(id)
			: options.tenantFieldName
				? extractTenantId((doc as Record<string, unknown> | undefined)?.[options.tenantFieldName])
				: undefined

		if (options.shouldLog) {
			const allow = await options.shouldLog({
				req,
				operation: 'delete',
				doc: (doc as Record<string, unknown> | undefined) ?? {},
				previousDoc: undefined,
				diff: {},
				changedPaths: [],
			})
			if (!allow) return
		}

		let snapshot: Record<string, unknown> | undefined
		if (options.snapshotOnDelete && doc) {
			const snapshotRaw = options.anonymize
				? anonymizeDoc(
						doc as Record<string, unknown>,
						options.collectionSlug,
						documentId,
						'delete',
						options.anonymize
					)
				: (doc as Record<string, unknown>)
			snapshot = options.fieldMap ? normalizeSnapshot(snapshotRaw, options.fieldMap) : snapshotRaw
		}

		await req.payload.create({
			collection: 'audit-logs',
			data: {
				operation: 'delete',
				relationTo: options.collectionSlug,
				documentId,
				...(userValue !== undefined && { user: userValue }),
				...(req.locale && { locale: req.locale }),
				payloadAPI: req.payloadAPI,
				...(ipAddress && { ipAddress }),
				...(userAgent && { userAgent }),
				...(snapshot && { snapshot }),
				...(tenantValue != null && { tenant: tenantValue }),
				...(group && { group }),
			},
			overrideAccess: true,
		})
	}
