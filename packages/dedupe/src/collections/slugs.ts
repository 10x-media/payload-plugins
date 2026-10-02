import type { CollectionSlug } from 'payload'

export const KEYS_SLUG = 'dedupe-keys' as CollectionSlug
export const PAIRS_SLUG = 'dedupe-pairs' as CollectionSlug
export const MERGES_SLUG = 'dedupe-merges' as CollectionSlug

/** Rows a page of the queue or the history holds when the address names no other number. */
export const PAGE_SIZE = 25

/** Rows a page holds for a `limit` from the address or a request, 1 to 100. */
export const pageSize = (value: unknown): number =>
	Math.min(100, Math.max(1, Math.trunc(Number(value)) || PAGE_SIZE))

export const PAIR_STATUSES = ['open', 'dismissed', 'merged', 'superseded', 'stale'] as const
export type PairStatus = (typeof PAIR_STATUSES)[number]

export const isStatus = (value: string | null | undefined): value is PairStatus =>
	PAIR_STATUSES.includes(value as PairStatus)

export const MERGE_STATUSES = ['applying', 'applied', 'failed'] as const
export type MergeStatus = (typeof MERGE_STATUSES)[number]
