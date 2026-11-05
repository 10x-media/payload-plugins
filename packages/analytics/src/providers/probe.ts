import { createHash } from 'node:crypto'
import type { Payload, SelectType, Where } from 'payload'
import { currentTime } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import { canonicalJson, isRecord } from '../core/values'
import { DETACHED } from '../db/openTransaction'
import { docScope } from '../plugin/scopeChange'
import { remember } from '../surfacing/bounded'

/** How long an instance trusts a probe before asking the database again: the bound on convergence. */
export const PROBE_MEMO_MS = 10_000

/** Far above any realistic document count for one scope. */
const MAX_ROWS = 1_000

/** Scopes memoized before the expired ones are dropped. */
const PRUNE_AT = 1_000

/** One document as the probe reads it: what tells a change apart, never a credential. */
export interface ProbeRow {
	id: string
	/** The last save as an ISO instant; empty for a document without one. */
	updatedAt: string
	enabled: boolean
	/** The provider type, on rows of the providers collection only. */
	provider?: string
	/** Only on a flagged providers row, so the epoch of rows nobody flagged stays as it was. */
	isDefault?: true
	scope: string | null
}

export interface Probe {
	/** In the order the database answers a lookup without a sort, which is the registry's order. */
	rows: readonly ProbeRow[]
	/** Equal for equal committed states, whatever order the rows came in. */
	epoch: string
}

/** A stored date as an ISO instant, or empty when there is none. */
export const versionOf = (value: unknown): string => {
	if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
		return ''
	}
	const ms = new Date(value).getTime()
	return Number.isNaN(ms) ? '' : new Date(ms).toISOString()
}

const byId = (a: ProbeRow, b: ProbeRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** A digest of the rows that ignores their order. */
export const probeEpoch = (rows: readonly ProbeRow[]): string =>
	createHash('sha256')
		.update(canonicalJson([...rows].sort(byId)))
		.digest('base64url')

/** A scope as every read keys it: absent or empty is the install-wide scope, null. */
export const scopeOf = (scope: string | null | undefined): string | null =>
	scope === undefined || scope === '' ? null : scope

export interface CollectionProbe {
	/** The scope's rows and epoch as committed, read outside any transaction and memoized per instance. */
	read(scope: string | null | undefined): Promise<Probe>
	/**
	 * A save on this instance touched these scopes: they are asked of the database on every read
	 * for one memo window, so this instance sees the save as soon as it commits. Writes nothing.
	 */
	expedite(scopes: Iterable<string | null>): void
}

interface CollectionProbeOptions {
	payload: Payload
	slug: string
	scopeField: string
	/** The clause selecting one scope's documents; absent, every scope reads every document. */
	where?: (scope: string | null) => Where
	/** Whether the collection's rows carry a `provider`. */
	provider?: boolean
	memoMs?: number
	now?: () => number
}

interface Memoized {
	at: number
	probe: Promise<Probe>
}

/**
 * Committed state of a collection's documents per scope, read on a detached request: an uncommitted
 * row is never seen, so nothing keyed on an epoch can roll back.
 */
export const createCollectionProbe = (options: CollectionProbeOptions): CollectionProbe => {
	const { payload, slug, scopeField } = options
	const memoMs = options.memoMs ?? PROBE_MEMO_MS
	const now = options.now ?? currentTime
	const select: SelectType = {
		updatedAt: true,
		enabled: true,
		[scopeField]: true,
		...(options.provider ? { provider: true, isDefault: true } : {}),
	}
	const memo = new Map<string, Memoized>()
	const expedited = new Map<string, number>()

	const rowOf = (doc: Record<string, unknown>): ProbeRow => ({
		id: String(doc.id),
		updatedAt: versionOf(doc.updatedAt),
		enabled: doc.enabled === true,
		...(options.provider ? { provider: typeof doc.provider === 'string' ? doc.provider : '' } : {}),
		...(options.provider && doc.isDefault === true ? { isDefault: true as const } : {}),
		scope: docScope(doc, scopeField),
	})

	const query = async (scope: string | null): Promise<Probe> => {
		if (!isCollectionSlug(payload, slug)) {
			throw new Error(`analytics: no "${slug}" collection is registered`)
		}
		const { docs } = await payload.db.find<Record<string, unknown>>({
			collection: slug,
			limit: MAX_ROWS,
			pagination: false,
			req: DETACHED,
			select,
			...(options.where ? { where: options.where(scope) } : {}),
		})
		const rows = docs.filter(isRecord).map(rowOf)
		return { rows, epoch: probeEpoch(rows) }
	}

	const prune = (at: number): void => {
		for (const [key, entry] of memo) {
			if (at - entry.at >= memoMs) {
				memo.delete(key)
			}
		}
		for (const [key, until] of expedited) {
			if (until <= at) {
				expedited.delete(key)
			}
		}
	}

	return {
		read(raw) {
			const scope = scopeOf(raw)
			const key = scope ?? ''
			const at = now()
			if ((expedited.get(key) ?? 0) > at) {
				return query(scope)
			}
			const hit = memo.get(key)
			if (hit && at - hit.at < memoMs) {
				return hit.probe
			}
			if (memo.size >= PRUNE_AT) {
				prune(at)
			}
			const probe = query(scope)
			remember(memo, [key, { at, probe }])
			probe.catch(() => {
				if (memo.get(key)?.probe === probe) {
					memo.delete(key)
				}
			})
			return probe
		},
		expedite(scopes) {
			const until = now() + memoMs
			for (const raw of scopes) {
				const key = scopeOf(raw) ?? ''
				memo.delete(key)
				remember(expedited, [key, until])
			}
		},
	}
}
