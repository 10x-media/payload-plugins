/** One row per hit: the raw store every aggregate and every filtered read comes from. */
export const HITS_SLUG = 'analytics-hits'

/** One row per scope, local day, hostname and one or two dimension values. */
export const AGGREGATES_SLUG = 'analytics-aggregates'

/** Salts, day markers, leases and heartbeats, each a row under a readable key. */
export const STATE_SLUG = 'analytics-state'

export const STORE_SLUGS: readonly string[] = [HITS_SLUG, AGGREGATES_SLUG, STATE_SLUG]

/** The slugs of the engine's three collections, which every store is built on. */
export interface StoreSlugs {
	hits: string
	aggregates: string
	state: string
}

export const DEFAULT_STORE_SLUGS: Readonly<StoreSlugs> = {
	hits: HITS_SLUG,
	aggregates: AGGREGATES_SLUG,
	state: STATE_SLUG,
}
