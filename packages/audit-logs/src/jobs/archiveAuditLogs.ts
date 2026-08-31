import { createGzip } from 'node:zlib'

import type { CollectionSlug, Field, GlobalSlug, TaskConfig, Where } from 'payload'

import type { AnonymizeFunction, ArchiveJobHooks } from '../types'
import { REDACTED } from '../types'
import { anonymizeDoc } from '../utilities/anonymize'

/**
 * Ordered list of all fields the plugin writes to the audit-logs collection.
 * User-defined fields (added via `logs.override`) are discovered from the collection config
 * and appended after these.
 */
const PLUGIN_COLUMNS = [
	'id',
	'operation',
	'eventType',
	'relationTo',
	'documentId',
	'user',
	'locale',
	'payloadAPI',
	'changedPaths',
	'diff',
	'snapshot',
	'metadata',
	'tenant',
	'createdAt',
	'ipAddress',
	'userAgent',
]

/** Fields managed by Payload internals, never meaningful to include in a CSV export. */
const ALWAYS_SKIP = new Set(['archivedAt', 'updatedAt'])

const escapeCell = (val: unknown): string => {
	if (val == null) return ''
	const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
	if (str.includes(',') || str.includes('\n') || str.includes('"')) {
		return `"${str.replace(/"/g, '""')}"`
	}
	return str
}

export type ArchiveTaskOptions = {
	cron: string
	queue: string
	uploadCollection: string
	where?: Where
	anonymize?: Partial<Record<string, AnonymizeFunction>>
	/**
	 * Fields to omit from the CSV columns.
	 * @default ['ipAddress', 'userAgent']
	 */
	excludeFields: string[]
	generateFilename?: (args: { logCount: number; runDate: Date }) => string
	populateUploadFields?: (args: {
		filename: string
		logCount: number
		runDate: Date
	}) => Record<string, unknown>
	hooks?: ArchiveJobHooks
}

export const buildArchiveTask = (options: ArchiveTaskOptions): TaskConfig => ({
	slug: 'audit-logs-archive',
	schedule: [{ cron: options.cron, queue: options.queue }],
	handler: async ({ req, job }) => {
		const excluded = new Set([...options.excludeFields, ...ALWAYS_SKIP])
		const pluginColumnSet = new Set(PLUGIN_COLUMNS)

		// Discover user-defined extra columns from the collection config.
		// This avoids buffering all docs just to find unknown keys.
		const auditLogsCollection = req.payload.config.collections.find((c) => c.slug === 'audit-logs')
		const extraFields = (auditLogsCollection?.fields ?? [])
			.filter(
				(f): f is Extract<Field, { name: string }> =>
					'name' in f && !pluginColumnSet.has(f.name) && !excluded.has(f.name)
			)
			.map((f) => f.name)
			.sort()

		const columns = [...PLUGIN_COLUMNS.filter((col) => !excluded.has(col)), ...extraFields]

		await options.hooks?.beforeRun?.({ req, job })

		// Stream-compress rows page by page, never hold more than one page of docs in memory.
		const gzip = createGzip()
		const chunks: Buffer[] = []
		gzip.on('data', (chunk: Buffer) => chunks.push(chunk))

		// Write CSV header before the first page arrives.
		gzip.write(`${columns.join(',')}\n`)

		let page = 1
		let hasNextPage = true
		const archivedIds: string[] = []

		while (hasNextPage) {
			const baseWhere: Where = { archivedAt: { exists: false } }
			const result = await req.payload.find({
				collection: 'audit-logs',
				where: options.where ? { and: [baseWhere, options.where] } : baseWhere,
				page,
				limit: 500,
				depth: 0,
				overrideAccess: true,
			})

			for (const doc of result.docs) {
				const collection = String(doc.relationTo) as CollectionSlug | GlobalSlug
				const documentId = String(doc.documentId ?? '')
				const anonymize = options.anonymize?.[collection]

				let diff = doc.diff as Record<string, { after: unknown; before: unknown }> | undefined
				let snapshot = doc.snapshot as Record<string, unknown> | undefined

				if (anonymize) {
					if (diff) {
						const anonDiff: typeof diff = {}
						for (const [path, { before, after }] of Object.entries(diff)) {
							anonDiff[path] = {
								before: anonymize({
									collection,
									documentId,
									operation: 'update',
									path,
									redacted: REDACTED,
									value: before,
								}),
								after: anonymize({
									collection,
									documentId,
									operation: 'update',
									path,
									redacted: REDACTED,
									value: after,
								}),
							}
						}
						diff = anonDiff
					}

					if (snapshot) {
						snapshot = anonymizeDoc(snapshot, collection, documentId, 'create', anonymize)
					}
				}

				const row: Record<string, unknown> = { ...doc, diff, snapshot }
				gzip.write(`${columns.map((col) => escapeCell(row[col])).join(',')}\n`)
				archivedIds.push(String(doc.id))
			}

			hasNextPage = result.hasNextPage
			await options.hooks?.afterBatch?.({
				req,
				job,
				page,
				docsInBatch: result.docs.length,
				totalProcessed: archivedIds.length,
			})
			page++
		}

		if (archivedIds.length === 0) {
			gzip.destroy()
			await options.hooks?.afterRun?.({ req, job, archived: 0, filename: null })
			return { output: { archived: 0 } }
		}

		gzip.end()
		await new Promise<void>((resolve) => gzip.on('finish', resolve))
		const compressed = Buffer.concat(chunks)

		const now = new Date()
		const basename =
			options.generateFilename?.({ logCount: archivedIds.length, runDate: now }) ??
			`audit-logs-${now.toISOString().slice(0, 10)}`
		const filename = `${basename}.csv.gz`

		const extraData =
			options.populateUploadFields?.({
				filename,
				logCount: archivedIds.length,
				runDate: now,
			}) ?? {}

		await req.payload.create({
			collection: options.uploadCollection as CollectionSlug,
			data: extraData,
			file: {
				data: compressed,
				mimetype: 'application/gzip',
				name: filename,
				size: compressed.length,
			},
			overrideAccess: true,
		})

		// Bulk mark as archived in batches to avoid large IN clauses
		const BATCH = 1000
		for (let i = 0; i < archivedIds.length; i += BATCH) {
			await req.payload.update({
				collection: 'audit-logs',
				where: { id: { in: archivedIds.slice(i, i + BATCH) } },
				data: { archivedAt: now.toISOString() },
				overrideAccess: true,
			})
		}

		await options.hooks?.afterRun?.({ req, job, archived: archivedIds.length, filename })
		return { output: { archived: archivedIds.length } }
	},
})
