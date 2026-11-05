import type { Config, PayloadRequest } from 'payload'

export type CandidateHit = { id: string }

export type KeyBucket = { key: string; ids: string[] }

/** A document with every locale of its match fields. */
export type AdapterDoc = Record<string, unknown> & { id?: number | string }

export type FindCandidatesArgs = {
	req: PayloadRequest
	collection: string
	/** Without `id` when the values are not saved yet. */
	doc: AdapterDoc
	/** Candidates at most. */
	limit: number
}

export type IndexArgs = {
	req: PayloadRequest
	collection: string
	doc: AdapterDoc & { id: number | string }
}

export type RemoveArgs = { req: PayloadRequest; collection: string; id: string }

export type ScanArgs = {
	req: PayloadRequest
	collection: string
	cursor: string | null
	/** Rows per page, not buckets. */
	limit: number
}

export type SearchArgs = {
	req: PayloadRequest
	collection: string
	/** What the reviewer typed in the queue's search. */
	search: string
	/** Documents at most. */
	limit: number
}

export type ScanPage = {
	buckets: KeyBucket[]
	/** Null when the last bucket has been returned. */
	nextCursor: string | null
	/** Keys whose bucket exceeded `limit` and was skipped. */
	oversized: string[]
}

/**
 * How the plugin looks for candidates: which documents are worth comparing with a given
 * one. Scoring, pairs, the queue and the scan stay the plugin's, so an adapter changes
 * which look-alikes are found, never how alike two documents are.
 */
export type DedupeAdapter = {
	/** Documents to compare with `doc`. The document itself may be among them. */
	findCandidates(args: FindCandidatesArgs): Promise<CandidateHit[]>
	/**
	 * Called on every save of a document the plugin compares and on the primary a merge writes,
	 * inside the write's transaction, and by the scan for every document it compares.
	 */
	index?(args: IndexArgs): Promise<void>
	/** Called when a document is deleted, trashed, unpublished or merged into another. */
	remove?(args: RemoveArgs): Promise<void>
	/**
	 * Every bucket of the collection, page by page, for the full scan. Without it the scan
	 * calls `findCandidates` once per document.
	 */
	scanBuckets?(args: ScanArgs): Promise<ScanPage>
	/**
	 * The documents the queue's search finds, the best match first: its groups holding one of
	 * them are shown. Without it the queue searches as the collection's list view does.
	 */
	search?(args: SearchArgs): Promise<CandidateHit[]>
	/** Config-time hook to add collections or endpoints of its own. */
	register?(config: Config): void
}

/**
 * Receives the adapter the level above uses (the built-in keys adapter for the plugin's
 * `adapter`, the plugin's adapter for a collection's): return it, extend it by spreading, or
 * replace it.
 */
export type DedupeAdapterFactory = (base: DedupeAdapter) => DedupeAdapter
