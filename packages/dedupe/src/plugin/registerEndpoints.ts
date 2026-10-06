import {
	APIError,
	addDataAndFileToRequest,
	type Config,
	type Endpoint,
	type PayloadRequest,
} from 'payload'

import { applyMerge } from '../merge/apply'
import {
	allReadable,
	checkGroup,
	docTitle,
	type LoadedDoc,
	loadDocs,
	READ_REFUSED,
} from '../merge/load'
import { buildPlanResponse } from '../merge/planResponse'
import type { ResolvedOptions } from '../options'
import { findDuplicates } from '../queue/live'
import { decideGroup, labelSignals, type SignalView } from '../queue/pairs'
import { runScan, type ScanSummary } from '../queue/scan'
import type { MergeChoice } from '../schema/types'
import { getCollectionContext, getContext, selectedTenant, tenantOf } from './context'
import { SCAN_TASK_SLUG } from './registerJobs'

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

const errorResponse = (error: unknown): Response => {
	if (error instanceof APIError) {
		return json({ message: error.message }, error.status)
	}
	return json({ message: error instanceof Error ? error.message : 'Unexpected error' }, 500)
}

/** Custom endpoints are not wrapped, so the body is parsed here; a missing one reads as `{}`. */
const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
	await addDataAndFileToRequest(req)
	return (req.data ?? {}) as Record<string, unknown>
}

const asString = (value: unknown): string | null =>
	typeof value === 'string' && value !== '' ? value : null

/** A document id, a number on SQL databases. */
const asId = (value: unknown): string | null =>
	typeof value === 'number' ? String(value) : asString(value)

/** A list of ids: an array of strings or numbers. */
const asIds = (value: unknown): string[] | null =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every((id) => typeof id === 'string' || typeof id === 'number')
		? value.map(String)
		: null

const asChoices = (value: unknown): Record<string, MergeChoice> => {
	if (!value || typeof value !== 'object') return {}
	const out: Record<string, MergeChoice> = {}
	for (const [key, choice] of Object.entries(value as Record<string, unknown>)) {
		if (!choice || typeof choice !== 'object') continue
		if ('doc' in choice && typeof choice.doc === 'string' && choice.doc !== '') {
			out[key] = { doc: choice.doc }
		} else if ('items' in choice && Array.isArray(choice.items)) {
			out[key] = {
				items: (choice.items as unknown[]).flatMap((item) => {
					const { doc, index } = (item ?? {}) as { doc?: unknown; index?: unknown }
					return typeof doc === 'string' && Number.isInteger(index)
						? [{ doc, index: index as number }]
						: []
				}),
			}
		}
	}
	return out
}

/** 401 for nobody, 403 for somebody the option turns away, as the admin's own routes do. */
const guard = async (
	req: PayloadRequest,
	kind: 'merge' | 'review',
	options: ResolvedOptions
): Promise<Response | null> => {
	if (!req.user) return json({ message: 'Unauthorized' }, 401)
	const allowed = await options.access[kind]({ req })
	return allowed ? null : json({ message: 'Forbidden' }, 403)
}

/**
 * Marks a group of documents not duplicates, or reopens it. Scoped as the queue is: a
 * document of another tenant than the one selected is answered as not there.
 */
const decideEndpoint = (options: ResolvedOptions, status: 'dismissed' | 'open'): Endpoint => ({
	method: 'post',
	path: status === 'dismissed' ? '/dedupe/dismiss' : '/dedupe/reopen',
	handler: async (req) => {
		const denied = await guard(req, 'review', options)
		if (denied) return denied
		try {
			const body = await readBody(req)
			const slug = asString(body.collection)
			const ids = asIds(body.docs)
			if (!slug || !ids || ids.length < 2) {
				return json({ message: 'collection and two or more docs are required' }, 400)
			}
			const ctx = getContext(req.payload)
			const col = getCollectionContext(req.payload, slug)
			const [first, ...rest] = ids as [string, ...string[]]
			checkGroup({ ctx, survivorId: first, absorbedIds: rest })
			if (!(await allReadable({ req, col, ids }))) return json({ message: READ_REFUSED }, 403)
			const docs = await loadDocs({ req, ctx, col, ids, trash: true })
			const tenant = selectedTenant(ctx, req)
			if (
				docs.length !== ids.length ||
				docs.some(
					(doc) => tenantOf(req.payload, doc) !== tenantOf(req.payload, docs[0] as LoadedDoc)
				) ||
				(tenant && col.tenanted && tenantOf(req.payload, docs[0] as LoadedDoc) !== tenant)
			) {
				return json({ message: 'Documents not found' }, 404)
			}
			await decideGroup({ req, ctx, col, docs, status })
			return json({ status })
		} catch (error) {
			return errorResponse(error)
		}
	},
})

const planEndpoint = (options: ResolvedOptions): Endpoint => ({
	method: 'post',
	path: '/dedupe/plan',
	handler: async (req) => {
		const denied = await guard(req, 'review', options)
		if (denied) return denied
		try {
			const body = await readBody(req)
			const slug = asString(body.collection)
			const survivorId = asId(body.survivor)
			const absorbedIds = asIds(body.absorbed)
			if (!slug || !survivorId || !absorbedIds) {
				return json({ message: 'collection, survivor and absorbed are required' }, 400)
			}
			const ctx = getContext(req.payload)
			const col = getCollectionContext(req.payload, slug)
			const plan = await buildPlanResponse({
				req,
				ctx,
				col,
				survivorId,
				absorbedIds,
				choices: asChoices(body.choices),
			})
			return json(plan)
		} catch (error) {
			return errorResponse(error)
		}
	},
})

const applyEndpoint = (options: ResolvedOptions): Endpoint => ({
	method: 'post',
	path: '/dedupe/apply',
	handler: async (req) => {
		const denied = await guard(req, 'merge', options)
		if (denied) return denied
		try {
			const body = await readBody(req)
			const slug = asString(body.collection)
			const survivorId = asId(body.survivor)
			const absorbedIds = asIds(body.absorbed)
			if (!slug || !survivorId || !absorbedIds) {
				return json({ message: 'collection, survivor and absorbed are required' }, 400)
			}
			const ctx = getContext(req.payload)
			const col = getCollectionContext(req.payload, slug)
			const expected =
				body.expected && typeof body.expected === 'object'
					? Object.fromEntries(
							Object.entries(body.expected as Record<string, unknown>).filter(
								(entry): entry is [string, string] => typeof entry[1] === 'string'
							)
						)
					: undefined
			const result = await applyMerge({
				req,
				ctx,
				col,
				survivorId,
				absorbedIds,
				choices: asChoices(body.choices),
				expected,
			})
			return json(result)
		} catch (error) {
			return errorResponse(error)
		}
	},
})

/**
 * Queues the scan task, or runs it in the request under `disableJobsQueue`. The choice is
 * the host's, not the caller's: a whole-collection scan inside a request is only for a
 * deployment without a worker.
 */
const scanEndpoint = (options: ResolvedOptions): Endpoint => ({
	method: 'post',
	path: '/dedupe/scan',
	handler: async (req) => {
		const denied = await guard(req, 'review', options)
		if (denied) return denied
		try {
			const body = await readBody(req)
			const slug = asString(body.collection)
			const ctx = getContext(req.payload)
			const targets = slug
				? [getCollectionContext(req.payload, slug)]
				: [...ctx.collections.values()].filter((col) => col.options.match)
			if (targets.some((col) => !col.options.match)) {
				return json({ message: 'Collection has no match config' }, 400)
			}
			if (options.disableJobsQueue) {
				const summaries: ScanSummary[] = []
				for (const col of targets) summaries.push(await runScan({ req, ctx, col }))
				return json({ inline: true, summaries })
			}
			// Without a collection the task scans every one that has a match config.
			const job = (await req.payload.jobs.queue({
				task: SCAN_TASK_SLUG as never,
				input: (slug ? { collection: slug } : {}) as never,
				queue: options.queue,
			})) as { id: number | string }
			return json({ inline: false, jobId: String(job.id) })
		} catch (error) {
			return errorResponse(error)
		}
	},
})

export type CheckResponse = {
	candidates: { id: string; title: string; score: number; signals: SignalView[] }[]
}

/**
 * The document form's question: which saved documents resemble these unsaved values. The
 * same search as a save, stored nowhere, and read as the reviewer so a document they may
 * not see is not named.
 */
const checkEndpoint = (options: ResolvedOptions): Endpoint => ({
	method: 'post',
	path: '/dedupe/check',
	handler: async (req) => {
		const denied = await guard(req, 'review', options)
		if (denied) return denied
		try {
			const body = await readBody(req)
			const slug = asString(body.collection)
			if (!slug) return json({ message: 'collection is required' }, 400)
			const col = getCollectionContext(req.payload, slug)
			const data = body.data && typeof body.data === 'object' ? body.data : {}
			const id = asId(body.id)
			const found = await findDuplicates({
				req,
				collection: slug,
				doc: { ...(data as Record<string, unknown>), ...(id ? { id } : {}) },
				overrideAccess: false,
			})
			const candidates = found.map(({ doc, score, signals }) => ({
				id: String(doc.id),
				title: docTitle(req, col.slug, doc),
				score,
				signals: labelSignals(req, col, signals),
			}))
			return json({ candidates } satisfies CheckResponse)
		} catch (error) {
			return errorResponse(error)
		}
	},
})

export const registerEndpoints = (config: Config, options: ResolvedOptions): void => {
	config.endpoints = [
		...(config.endpoints ?? []),
		decideEndpoint(options, 'dismissed'),
		decideEndpoint(options, 'open'),
		planEndpoint(options),
		applyEndpoint(options),
		scanEndpoint(options),
		checkEndpoint(options),
	]
}
