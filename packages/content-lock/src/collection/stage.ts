import type { Where } from 'payload'

import type { WindowStatus } from '../state/types'
import { keys, type TranslationKey } from '../translations/keys'

/** A window's stage as the list and the sidebar show it. */
export type LockStage = WindowStatus | 'draft'

/** Display order of the stages, most urgent first. */
export const LOCK_STAGES: readonly LockStage[] = [
	'active',
	'announced',
	'pending',
	'draft',
	'ended',
]

/** Payload pill styles: red active, yellow announced, blue pending, grey otherwise. */
export const stagePillStyle: Record<LockStage, 'error' | 'warning' | 'success' | 'light-gray'> = {
	active: 'error',
	announced: 'warning',
	pending: 'success',
	draft: 'light-gray',
	ended: 'light-gray',
}

export const stageLabel: Record<LockStage, TranslationKey> = {
	active: keys.statusActive,
	announced: keys.statusAnnounced,
	pending: keys.statusPending,
	draft: keys.statusDraft,
	ended: keys.statusEnded,
}

export const isLockStage = (value: unknown): value is LockStage =>
	typeof value === 'string' && value in stagePillStyle

const PUBLISHED: Where = { _status: { equals: 'published' } }

/**
 * Expand a conjunction into the `{ or: [{ and: [...] }] }` shape the admin's
 * filter builder edits; it shows nothing for a nested `or`. A term that is an
 * array is a set of alternatives, so the result has one `and` group per
 * combination of them.
 */
const anyOfAll = (...terms: Array<Where | Where[]>): Where => {
	let groups: Where[][] = [[]]
	for (const term of terms) {
		const alternatives = Array.isArray(term) ? term : [term]
		groups = groups.flatMap((group) => alternatives.map((alternative) => [...group, alternative]))
	}
	return { or: groups.map((and) => ({ and })) }
}

/**
 * Windows in `stage` at `now`, as a query. The stage is derived, never stored,
 * so this spells out `statusOf` over the stored fields for list filters and
 * counts. A window stored without the `announce` toggle announces when it has
 * a date, as its field does. The result is in the filter builder's shape, so a
 * stage picked in the filter bar stays editable in Filters.
 */
export const stageWhere = (stage: LockStage, now: Date): Where => {
	const at = now.toISOString()
	const notEnded: Array<Where | Where[]> = [
		{ endedAt: { exists: false } },
		[
			{ endAtTime: { equals: false } },
			{ endAtTime: { exists: false } },
			{ endsAt: { greater_than: at } },
		],
	]
	const upcoming: Array<Where | Where[]> = [
		PUBLISHED,
		...notEnded,
		{ startsAt: { greater_than: at } },
	]
	switch (stage) {
		case 'draft':
			return anyOfAll({ _status: { equals: 'draft' } })
		case 'ended':
			return {
				or: [
					{ and: [PUBLISHED, { endedAt: { exists: true } }] },
					{
						and: [PUBLISHED, { endAtTime: { equals: true } }, { endsAt: { less_than_equal: at } }],
					},
				],
			}
		case 'active':
			return anyOfAll(PUBLISHED, ...notEnded, { startsAt: { less_than_equal: at } })
		case 'announced':
			return anyOfAll(...upcoming, { announceAt: { less_than_equal: at } }, [
				{ announce: { equals: true } },
				{ announce: { exists: false } },
			])
		case 'pending':
			return anyOfAll(...upcoming, [
				{ announceAt: { exists: false } },
				{ announceAt: { greater_than: at } },
				{ announce: { equals: false } },
			])
	}
}
