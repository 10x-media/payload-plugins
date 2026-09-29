import { describe, expect, it } from 'vitest'

import { isEntityLocked, pickBanner, resolveState, scopeOf, statusOf } from './resolve'
import type { LockGroup, LockWindow } from './types'

const at = (iso: string) => new Date(iso)

const window = (overrides: Partial<LockWindow> = {}): LockWindow => ({
	id: 'w1',
	title: 'Window',
	announceAt: null,
	startsAt: '2026-01-10T10:00:00.000Z',
	endMode: 'manual',
	endsAt: null,
	endedAt: null,
	scope: 'everything',
	targets: [],
	...overrides,
})

const groups: LockGroup[] = [
	{ key: 'catalog', label: 'Catalog', collections: ['products', 'categories'], globals: [] },
	{ key: 'site', label: 'Site', collections: ['pages', 'posts'], globals: ['header'] },
]

describe('statusOf', () => {
	const scheduled = window({
		announceAt: '2026-01-09T10:00:00.000Z',
		endMode: 'at',
		endsAt: '2026-01-10T12:00:00.000Z',
	})

	it('walks pending, announced, active, ended', () => {
		expect(statusOf(scheduled, at('2026-01-08T00:00:00.000Z'))).toBe('pending')
		expect(statusOf(scheduled, at('2026-01-09T10:00:00.000Z'))).toBe('announced')
		expect(statusOf(scheduled, at('2026-01-10T10:00:00.000Z'))).toBe('active')
		expect(statusOf(scheduled, at('2026-01-10T12:00:00.000Z'))).toBe('ended')
	})

	it('stays pending until start without an announcement', () => {
		expect(statusOf(window(), at('2026-01-10T09:59:59.999Z'))).toBe('pending')
	})

	it('ignores endsAt for manual windows', () => {
		const manual = window({ endsAt: '2026-01-10T11:00:00.000Z' })
		expect(statusOf(manual, at('2026-01-20T00:00:00.000Z'))).toBe('active')
	})

	it('ends at endedAt, even before start', () => {
		const ended = window({ endedAt: '2026-01-10T11:00:00.000Z' })
		expect(statusOf(ended, at('2026-01-10T11:00:00.000Z'))).toBe('ended')
		const cancelled = window({ endedAt: '2026-01-05T00:00:00.000Z' })
		expect(statusOf(cancelled, at('2026-01-10T10:30:00.000Z'))).toBe('ended')
	})
})

describe('scopeOf', () => {
	it('expands groups and raw refs, ignoring unknown groups', () => {
		const scope = scopeOf(
			window({
				scope: 'selected',
				targets: ['group:catalog', 'collection:pages', 'global:footer', 'group:gone'],
			}),
			groups
		)
		expect(scope).toEqual({
			everything: false,
			collections: ['products', 'categories', 'pages'],
			globals: ['footer'],
		})
	})
})

describe('resolveState', () => {
	const now = at('2026-01-10T11:00:00.000Z')

	it('is unlocked with no active window', () => {
		const state = resolveState([window({ startsAt: '2026-01-11T00:00:00.000Z' })], now, groups)
		expect(state.locked).toBe(false)
		expect(isEntityLocked(state, { type: 'collection', slug: 'pages' })).toBe(false)
	})

	it('unions selected scopes of overlapping windows', () => {
		const state = resolveState(
			[
				window({ id: 'a', scope: 'selected', targets: ['group:catalog'] }),
				window({ id: 'b', scope: 'selected', targets: ['global:header'] }),
			],
			now,
			groups
		)
		expect(isEntityLocked(state, { type: 'collection', slug: 'products' })).toBe(true)
		expect(isEntityLocked(state, { type: 'global', slug: 'header' })).toBe(true)
		expect(isEntityLocked(state, { type: 'collection', slug: 'pages' })).toBe(false)
	})

	it('lets one everything window cover all', () => {
		const state = resolveState(
			[window({ id: 'a', scope: 'selected', targets: ['group:catalog'] }), window({ id: 'b' })],
			now,
			groups
		)
		expect(state.scope).toEqual({ everything: true })
	})

	it('reports the latest end, or null when any window is manual', () => {
		const timed = (id: string, endsAt: string) => window({ id, endMode: 'at', endsAt })
		expect(
			resolveState(
				[timed('a', '2026-01-10T12:00:00.000Z'), timed('b', '2026-01-10T13:00:00.000Z')],
				now,
				groups
			).endsAt
		).toBe('2026-01-10T13:00:00.000Z')
		expect(
			resolveState([timed('a', '2026-01-10T12:00:00.000Z'), window({ id: 'b' })], now, groups)
				.endsAt
		).toBeNull()
	})

	it('lists announced windows separately', () => {
		const state = resolveState(
			[
				window({
					id: 'soon',
					announceAt: '2026-01-10T00:00:00.000Z',
					startsAt: '2026-01-11T00:00:00.000Z',
				}),
			],
			now,
			groups
		)
		expect(state.locked).toBe(false)
		expect(state.announced.map((w) => w.id)).toEqual(['soon'])
	})
})

describe('pickBanner', () => {
	const now = at('2026-01-10T11:00:00.000Z')
	const announced = window({
		id: 'announced-all',
		announceAt: '2026-01-10T00:00:00.000Z',
		startsAt: '2026-01-12T00:00:00.000Z',
	})
	const activeCatalog = window({
		id: 'active-catalog',
		scope: 'selected',
		targets: ['group:catalog'],
	})
	const activeSite = window({ id: 'active-site', scope: 'selected', targets: ['group:site'] })

	it('prefers active over announced, then the larger scope', () => {
		const state = resolveState([announced, activeCatalog, activeSite], now, groups)
		expect(pickBanner(state, groups, null)?.id).toBe('active-site')
	})

	it('prefers the window touching the current route', () => {
		const state = resolveState([announced, activeCatalog, activeSite], now, groups)
		expect(pickBanner(state, groups, { type: 'collection', slug: 'products' })?.id).toBe(
			'active-catalog'
		)
		expect(pickBanner(state, groups, { type: 'collection', slug: 'media' })?.id).toBe(
			'announced-all'
		)
	})

	it('returns null when nothing is announced or active', () => {
		expect(pickBanner(resolveState([], now, groups), groups, null)).toBeNull()
	})
})
