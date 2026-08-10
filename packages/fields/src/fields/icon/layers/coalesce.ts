import type { IconLayerContext, IconMeta } from '../../../types'

export type ResolveMetaMany = (
	names: string[],
	ctx: IconLayerContext
) => Promise<Map<string, IconMeta>>

type Pending = {
	names: Set<string>
	result: Promise<Map<string, IconMeta>>
	resolve: (value: Map<string, IconMeta>) => void
	reject: (error: unknown) => void
}

const pending = new Map<string, Pending>()

/**
 * Batches `resolveMetaMany` calls issued within one microtask into a single call.
 *
 * The window is a microtask rather than a request, because the surface with the most to
 * gain has no request to key on: Payload renders list cells with `payload` and `i18n`
 * only. A server-rendered list resolves its cells in the same tick, so a microtask window
 * collapses fifty rows into one query without needing a request handle at all.
 */
export const coalesceResolveMany = (args: {
	ctx: IconLayerContext
	key: string
	name: string
	resolveMetaMany: ResolveMetaMany
}): Promise<Map<string, IconMeta>> => {
	const { ctx, key, name, resolveMetaMany } = args
	let batch = pending.get(key)
	if (!batch) {
		let resolve: (value: Map<string, IconMeta>) => void = () => {}
		let reject: (error: unknown) => void = () => {}
		const result = new Promise<Map<string, IconMeta>>((resolveFn, rejectFn) => {
			resolve = resolveFn
			reject = rejectFn
		})
		const created: Pending = { names: new Set(), reject, resolve, result }
		batch = created
		pending.set(key, created)
		// Dispatch after the current microtask drain, so every synchronous caller in this
		// tick lands in the same batch. The entry is cleared first, so a lookup issued from
		// a `.then` on this batch opens a fresh one rather than joining a dispatched batch.
		queueMicrotask(() => {
			if (pending.get(key) !== created) return
			pending.delete(key)
			resolveMetaMany([...created.names], ctx).then(created.resolve, created.reject)
		})
	}
	batch.names.add(name)
	return batch.result
}
