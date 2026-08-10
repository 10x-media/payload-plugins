import type { CollectionAfterChangeHook } from 'payload'

import type { AnonymizeFunction, ShouldLogFunction } from '../types'
import { REDACTED } from '../types'
import { anonymizeDoc } from '../utilities/anonymize'
import type { FieldMap } from '../utilities/buildFieldMap'
import { computeDiff, normalizeSnapshot } from '../utilities/diff'
import { getClientIP, getUserAgent } from '../utilities/request'
import { extractTenantId } from '../utilities/tenant'

export type AuditLogAfterChangeOptions = {
	anonymize?: AnonymizeFunction
	collectionSlug: string
	collectIpAddress: boolean
	collectUserAgent: boolean
	drafts: 'ignore' | 'log'
	excludeFields?: string[]
	fieldMap?: FieldMap
	groupContextKey?: string
	isUserPolymorphic: boolean
	isSelfTenant?: boolean
	operations: Array<'create' | 'delete' | 'update'>
	shouldLog?: ShouldLogFunction
	snapshotOnCreate: boolean
	tenantFieldName?: string
}

// biome-ignore lint/complexity/useMaxParams: the five values are exactly what AnonymizeFunction is called with
const applyAnonymization = (
	diff: Record<string, { after: unknown; before: unknown }>,
	collectionSlug: string,
	documentId: string,
	operation: 'create' | 'delete' | 'update',
	anonymize: AnonymizeFunction
): Record<string, { after: unknown; before: unknown }> => {
	const result: Record<string, { after: unknown; before: unknown }> = {}

	for (const [path, { before, after }] of Object.entries(diff)) {
		result[path] = {
			before: anonymize({
				path,
				value: before,
				collection: collectionSlug,
				documentId,
				operation,
				redacted: REDACTED,
			}),
			after: anonymize({
				path,
				value: after,
				collection: collectionSlug,
				documentId,
				operation,
				redacted: REDACTED,
			}),
		}
	}

	return result
}

export const afterChangeCollectionAuditLog =
	(options: AuditLogAfterChangeOptions): CollectionAfterChangeHook =>
	async ({ req, doc, previousDoc, operation }) => {
		if (!options.operations.includes(operation)) return

		// Draft handling: skip autosave draft saves; on publish fetch the last published version
		// so the diff reflects "previous publish → new publish" rather than "last draft → publish".
		// Create is always logged regardless — the document coming into existence is a meaningful event.
		if (options.drafts === 'ignore' && operation !== 'create' && doc._status === 'draft') return

		const documentId = String(doc.id)
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
			? extractTenantId((doc as Record<string, unknown>).id)
			: options.tenantFieldName
				? extractTenantId((doc as Record<string, unknown>)[options.tenantFieldName])
				: undefined

		if (
			options.drafts === 'ignore' &&
			doc._status === 'published' &&
			previousDoc?._status === 'draft'
		) {
			const prevVersionResult = await req.payload.findVersions({
				collection: options.collectionSlug,
				where: {
					and: [
						{ parent: { equals: documentId } },
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

		// On create: never diff (previousDoc is empty). Store snapshot if enabled.
		if (operation === 'create') {
			if (options.shouldLog) {
				const allow = await options.shouldLog({
					req,
					operation: 'create',
					doc: doc as Record<string, unknown>,
					previousDoc: undefined,
					diff: {},
					changedPaths: [],
				})
				if (!allow) return
			}

			const snapshotRaw = options.snapshotOnCreate
				? options.anonymize
					? anonymizeDoc(
							doc as Record<string, unknown>,
							options.collectionSlug,
							documentId,
							'create',
							options.anonymize
						)
					: (doc as Record<string, unknown>)
				: undefined
			const snapshot =
				snapshotRaw && options.fieldMap
					? normalizeSnapshot(snapshotRaw, options.fieldMap)
					: snapshotRaw

			await req.payload.create({
				collection: 'audit-logs',
				data: {
					operation: 'create',
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
			return
		}

		const { changedPaths, diff } = computeDiff(
			previousDoc as Record<string, unknown>,
			doc as Record<string, unknown>,
			options.excludeFields,
			options.fieldMap
		)

		// On update with no changes, skip — only excluded fields changed
		if (operation === 'update' && changedPaths.length === 0) return

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
			? applyAnonymization(diff, options.collectionSlug, documentId, operation, options.anonymize)
			: diff

		await req.payload.create({
			collection: 'audit-logs',
			data: {
				operation,
				relationTo: options.collectionSlug,
				documentId,
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
