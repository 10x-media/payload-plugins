import type { AdapterContext } from '../core/contract'

/** When an adapter read its answer, for `meta.fetchedAt`: the engine's clock, else the real one. */
export const readTime = (ctx: AdapterContext | undefined): string =>
	(ctx?.now?.() ?? new Date()).toISOString()
