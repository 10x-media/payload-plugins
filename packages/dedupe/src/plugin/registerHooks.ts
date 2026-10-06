import type {
	CollectionAfterChangeHook,
	CollectionAfterDeleteHook,
	Config,
	PayloadRequest,
} from 'payload'
import { isLive, type LoadedDoc, loadDoc, localRequest } from '../merge/load'
import type { ResolvedOptions } from '../options'
import { checkDocument } from '../queue/live'
import { closePairsFor } from '../queue/pairs'
import { type CollectionContext, getContext, type PluginContext } from './context'
import { CHECK_TASK_SLUG } from './registerJobs'

const isDedupeWrite = (context: Record<string, unknown> | undefined): boolean =>
	Boolean(context?.dedupe)

/**
 * File a saved document as a save files it: indexed inside the write's transaction through
 * `req`, and checked by a job queued there, which exists only once the write commits, so a
 * failure in the check leaves the write alone. Checked right away under `disableJobsQueue`.
 */
export const fileDocument = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	doc: LoadedDoc
}): Promise<void> => {
	const { req, ctx, col, doc } = args
	await col.adapter.index?.({ req, collection: col.slug, doc })
	if (ctx.options.disableJobsQueue) {
		await checkDocument({ req, ctx, col, doc })
		return
	}
	await req.payload.jobs.queue({
		task: CHECK_TASK_SLUG as never,
		input: { collection: col.slug, id: String(doc.id) } as never,
		queue: ctx.options.queue,
		req,
	})
}

/**
 * Keeps the index and the queue current on every save. The index is written inside the
 * save's transaction through `req`, and the check is queued there as a job, or run there
 * under `disableJobsQueue`. A save the plugin makes itself is skipped by context.
 */
const afterChange: CollectionAfterChangeHook = async ({ collection, doc, req }) => {
	if (isDedupeWrite(req.context)) return doc
	const ctx = getContext(req.payload)
	const col = ctx.collections.get(collection.slug)
	if (!col) return doc

	const saved = doc as LoadedDoc
	if (saved.deletedAt) {
		if (col.options.match) {
			await col.adapter.remove?.({ req, collection: col.slug, id: String(saved.id) })
		}
		await closePairsFor({
			req,
			col,
			docIds: [saved.id],
			group: null,
			mergeId: null,
			keepDismissed: true,
		})
		return doc
	}
	if (!col.options.match || !col.options.checkOnSave) return doc
	// A draft saved over a published document leaves that one as it was. Taken off publication,
	// a document leaves the index, so it pairs with nothing until published again.
	if (col.hasDrafts && !col.options.draft && saved._status === 'draft') {
		const published = (await req.payload.findByID({
			collection: col.slug,
			id: saved.id,
			depth: 0,
			select: { _status: true, deletedAt: true },
			overrideAccess: true,
			disableErrors: true,
			req: localRequest(req),
		})) as LoadedDoc | null
		if (!published || !isLive(col, published)) {
			await col.adapter.remove?.({ req, collection: col.slug, id: String(saved.id) })
		}
		return doc
	}

	// The hook receives the document as its saver may read it, in one locale; the index and the
	// scorer need every field in every locale.
	const full = await loadDoc({ req, ctx, col, id: saved.id })
	if (full) await fileDocument({ req, ctx, col, doc: full })
	return doc
}

const afterDelete: CollectionAfterDeleteHook = async ({ collection, id, req }) => {
	if (isDedupeWrite(req.context)) return
	const ctx = getContext(req.payload)
	const col = ctx.collections.get(collection.slug)
	if (!col) return
	if (col.options.match) await col.adapter.remove?.({ req, collection: col.slug, id: String(id) })
	await closePairsFor({ req, col, docIds: [id], group: null, mergeId: null })
}

export const registerHooks = (config: Config, options: ResolvedOptions): void => {
	const targets = new Set(options.collections.map((entry) => entry.slug as string))
	config.collections = (config.collections ?? []).map((collection) => {
		if (!targets.has(collection.slug)) return collection
		return {
			...collection,
			hooks: {
				...collection.hooks,
				afterChange: [...(collection.hooks?.afterChange ?? []), afterChange],
				afterDelete: [...(collection.hooks?.afterDelete ?? []), afterDelete],
			},
		}
	})
}
