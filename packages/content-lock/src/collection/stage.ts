import type { Where } from 'payload'

import type { WindowStatus } from '../state/types'
import { keys, type TranslationKey } from '../translations/keys'
import { notEndedWhere } from './access'

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
 * Windows in `stage` at `now`, as a query. The stage is derived, never stored,
 * so this spells out `statusOf` over the stored fields for list filters and
 * counts. A window stored without the `announce` toggle announces when it has
 * a date, as its field does.
 */
export const stageWhere = (stage: LockStage, now: Date): Where => {
	const at = now.toISOString()
	const announcing: Where = {
		and: [
			{ announceAt: { less_than_equal: at } },
			{ or: [{ announce: { equals: true } }, { announce: { exists: false } }] },
		],
	}
	const upcoming: Where = {
		and: [PUBLISHED, notEndedWhere(now), { startsAt: { greater_than: at } }],
	}
	switch (stage) {
		case 'draft':
			return { _status: { equals: 'draft' } }
		case 'ended':
			return {
				and: [
					PUBLISHED,
					{
						or: [
							{ endedAt: { exists: true } },
							{ and: [{ endAtTime: { equals: true } }, { endsAt: { less_than_equal: at } }] },
						],
					},
				],
			}
		case 'active':
			return { and: [PUBLISHED, notEndedWhere(now), { startsAt: { less_than_equal: at } }] }
		case 'announced':
			return { and: [upcoming, announcing] }
		case 'pending':
			return {
				and: [
					upcoming,
					{
						or: [
							{ announceAt: { exists: false } },
							{ announceAt: { greater_than: at } },
							{ announce: { equals: false } },
						],
					},
				],
			}
	}
}
