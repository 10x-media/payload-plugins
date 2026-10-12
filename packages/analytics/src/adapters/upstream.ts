import type { AdapterContext } from '../core/contract'
import { type FetchJsonOptions, fetchJson } from './http/fetchJson'

/**
 * Sends one vendor request through the read's lane when the surfacing engine runs the read, or
 * straight out with the read's own signal when something else calls the adapter.
 */
export const upstream = <T>(
	ctx: AdapterContext,
	fn: (signal?: AbortSignal) => Promise<T>
): Promise<T> => (ctx.upstream ? ctx.upstream(fn) : fn(ctx.signal))

/** A {@link fetchJson} request sent through {@link upstream}, with the signal the lane hands it. */
export const upstreamJson = <T>(
	ctx: AdapterContext,
	url: string,
	opts: Omit<FetchJsonOptions, 'signal'>
): Promise<T> => upstream(ctx, (signal) => fetchJson<T>(url, { ...opts, signal }))
