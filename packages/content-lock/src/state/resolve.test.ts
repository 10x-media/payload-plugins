import { describe, expect, it } from 'vitest'

import { entityOf, isEntityLocked, orderBanners, resolveState, scopeOf, statusOf } from './resolve'
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
	{
		key: 'catalog',
		label: 'Catalog',
		collections: ['products', 'categories'],
		globals: [],
		custom: [],
	},
	{
		key: 'site',
		label: 'Site',
		collections: ['pages', 'posts'],
		globals: ['header'],
		custom: ['reports'],
	},
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
			custom: [],
		})
	})

	it('expands custom targets, raw and through a group', () => {
		const scope = scopeOf(
			window({ scope: 'selected', targets: ['group:site', 'custom:crm-sync'] }),
			groups
		)
		expect(scope).toMatchObject({ custom: ['reports', 'crm-sync'] })
	})
})

describe('isEntityLocked', () => {
	const now = at('2026-01-10T11:00:00.000Z')

	it('never reports an exempt collection as locked', () => {
		const state = resolveState([window()], now, { exempt: ['form-submissions'], groups })
		expect(isEntityLocked(state, { type: 'collection', slug: 'posts' })).toBe(true)
		expect(isEntityLocked(state, { type: 'collection', slug: 'form-submissions' })).toBe(false)
	})

	it('reports custom targets a lock covers', () => {
		const everything = resolveState([window()], now, { groups })
		expect(isEntityLocked(everything, { type: 'custom', slug: 'reports' })).toBe(true)
		const site = resolveState([window({ scope: 'selected', targets: ['group:site'] })], now, {
			groups,
		})
		expect(isEntityLocked(site, { type: 'custom', slug: 'reports' })).toBe(true)
		expect(isEntityLocked(site, { type: 'custom', slug: 'crm-sync' })).toBe(false)
	})
})

describe('resolveState', () => {
	const now = at('2026-01-10T11:00:00.000Z')

	it('is unlocked with no active window', () => {
		const state = resolveState([window({ startsAt: '2026-01-11T00:00:00.000Z' })], now, { groups })
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
			{ groups }
		)
		expect(isEntityLocked(state, { type: 'collection', slug: 'products' })).toBe(true)
		expect(isEntityLocked(state, { type: 'global', slug: 'header' })).toBe(true)
		expect(isEntityLocked(state, { type: 'collection', slug: 'pages' })).toBe(false)
	})

	it('lets one everything window cover all', () => {
		const state = resolveState(
			[window({ id: 'a', scope: 'selected', targets: ['group:catalog'] }), window({ id: 'b' })],
			now,
			{ groups }
		)
		expect(state.scope).toEqual({ everything: true })
	})

	it('reports the latest end, or null when any window is manual', () => {
		const timed = (id: string, endsAt: string) => window({ id, endMode: 'at', endsAt })
		expect(
			resolveState(
				[timed('a', '2026-01-10T12:00:00.000Z'), timed('b', '2026-01-10T13:00:00.000Z')],
				now,
				{ groups }
			).endsAt
		).toBe('2026-01-10T13:00:00.000Z')
		expect(
			resolveState([timed('a', '2026-01-10T12:00:00.000Z'), window({ id: 'b' })], now, { groups })
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
			{ groups }
		)
		expect(state.locked).toBe(false)
		expect(state.announced.map((w) => w.id)).toEqual(['soon'])
	})
})

describe('orderBanners', () => {
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
	const ids = (windows: LockWindow[]) => windows.map((entry) => entry.id)

	it('puts active before announced, active ones by the larger scope', () => {
		const state = resolveState([announced, activeCatalog, activeSite], now, { groups })
		expect(ids(orderBanners(state, groups, null))).toEqual([
			'active-site',
			'active-catalog',
			'announced-all',
		])
	})

	it('keeps only the windows covering the current route, active first', () => {
		const state = resolveState([announced, activeCatalog, activeSite], now, { groups })
		expect(ids(orderBanners(state, groups, { type: 'collection', slug: 'products' }))).toEqual([
			'active-catalog',
			'announced-all',
		])
		expect(ids(orderBanners(state, groups, { type: 'collection', slug: 'media' }))).toEqual([
			'announced-all',
		])
	})

	it('orders announcements by the nearest start, then the larger scope', () => {
		const soonCatalog = window({
			id: 'soon-catalog',
			announceAt: '2026-01-10T00:00:00.000Z',
			startsAt: '2026-01-11T00:00:00.000Z',
			scope: 'selected',
			targets: ['group:catalog'],
		})
		const soonAll = window({
			id: 'soon-all',
			announceAt: '2026-01-10T00:00:00.000Z',
			startsAt: '2026-01-11T00:00:00.000Z',
		})
		const state = resolveState([announced, soonCatalog, soonAll], now, { groups })
		expect(ids(orderBanners(state, groups, null))).toEqual([
			'soon-all',
			'soon-catalog',
			'announced-all',
		])
	})

	it('is empty when nothing is announced or active', () => {
		expect(orderBanners(resolveState([], now, { groups }), groups, null)).toEqual([])
	})
})

describe('entityOf', () => {
	it('maps each target kind to its entity', () => {
		expect(entityOf({ collection: 'posts' })).toEqual({ type: 'collection', slug: 'posts' })
		expect(entityOf({ global: 'header' })).toEqual({ type: 'global', slug: 'header' })
		expect(entityOf({ custom: 'crm-sync' })).toEqual({ type: 'custom', slug: 'crm-sync' })
	})
})
