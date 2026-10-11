import { describe, expect, it } from 'vitest'
import { dedupeKeyFor } from '../ingest/revenue'
import {
	countedHit,
	countedHits,
	holdsVisit,
	TOMBSTONE_CLEARED,
	TWIN_WINDOW_MS,
	tombstoneOf,
	twinsWithin,
} from './hits'
import { orderHitId } from './ids'
import type { HitRow } from './types'

const order = (origin: 'wire' | 'server') =>
	orderHitId(dedupeKeyFor({ origin, tenant: 'shop', goal: 'purchase', orderId: 'ord_1' }))

const base: HitRow = {
	id: '',
	scope: 'shop',
	ts: new Date('2026-10-06T12:00:00.000Z'),
	type: 'goal',
	name: 'purchase',
	hostname: 'shop.example',
	path: '/checkout',
	v: 'V1',
	landing: false,
	server: false,
}

const wire: HitRow = {
	...base,
	id: order('wire'),
	country: 'DE',
	device: 'mobile',
	utmCampaign: 'fall',
	value: 9,
	currency: 'USD',
	goals: [{ slug: 'purchase', value: 9 }],
	conversions: 1,
	revenue: 9,
}

const server: HitRow = {
	...base,
	id: order('server'),
	ts: new Date('2026-10-07T09:00:00.000Z'),
	path: '/orders',
	v: '',
	server: true,
	value: 250,
	currency: 'EUR',
	originalValue: 260,
	originalCurrency: 'CHF',
	goals: [{ slug: 'purchase', value: 250, sent: 260 }],
	conversions: 1,
	revenue: 250,
}

const storedOf = (...hits: HitRow[]) => new Map(hits.map((hit) => [hit.id, hit]))

describe('countedHit', () => {
	it("credits the server's sale to the browser's record, which keeps its own place", () => {
		const stored = storedOf(wire, server)
		const counted = countedHit(wire, stored, TWIN_WINDOW_MS)
		expect(counted).toMatchObject({
			id: wire.id,
			ts: wire.ts,
			path: '/checkout',
			v: 'V1',
			country: 'DE',
			device: 'mobile',
			utmCampaign: 'fall',
			server: false,
			value: 250,
			currency: 'EUR',
			originalValue: 260,
			originalCurrency: 'CHF',
			goals: [{ slug: 'purchase', value: 250, sent: 260 }],
			conversions: 1,
			revenue: 250,
		})
		expect(countedHit(server, stored, TWIN_WINDOW_MS)).toBeNull()
	})

	it('drops a sale field the server never stored rather than keeping the browser one', () => {
		const bare: HitRow = { ...server }
		Reflect.deleteProperty(bare, 'originalValue')
		Reflect.deleteProperty(bare, 'originalCurrency')
		const withOriginal: HitRow = { ...wire, originalValue: 10, originalCurrency: 'GBP' }
		const counted = countedHit(withOriginal, storedOf(withOriginal, bare), TWIN_WINDOW_MS)
		expect(counted).not.toHaveProperty('originalValue')
		expect(counted).not.toHaveProperty('originalCurrency')
	})

	it("carries the server's item, on no page, and keeps the browser's own when the server names none", () => {
		const sold: HitRow = { ...server, item: 'offers:12' }
		expect(countedHit(wire, storedOf(wire, sold), TWIN_WINDOW_MS)).toMatchObject({
			item: 'offers:12',
			server: true,
			path: '/checkout',
		})
		const clicked: HitRow = { ...wire, item: 'offers:7' }
		expect(countedHit(clicked, storedOf(clicked, server), TWIN_WINDOW_MS)).toMatchObject({
			item: 'offers:7',
			server: false,
		})
	})

	it("further apart than the window, counts the server's sale on its own and the browser's record without one", () => {
		const late: HitRow = { ...server, ts: new Date(wire.ts.getTime() + TWIN_WINDOW_MS + 1) }
		const stored = storedOf(wire, late)
		const counted = countedHit(wire, stored, TWIN_WINDOW_MS)
		expect(counted).toMatchObject({ id: wire.id, v: 'V1', country: 'DE' })
		for (const field of ['conversions', 'revenue', 'goals', 'value', 'currency'] as const) {
			expect(counted).not.toHaveProperty(field)
		}
		expect(countedHit(late, stored, TWIN_WINDOW_MS)).toBe(late)
		expect(countedHit(wire, stored, null)).toMatchObject({ revenue: 250 })
		expect(countedHit(late, stored, null)).toBeNull()
	})

	it('counts an order one side recorded exactly as that side stored it', () => {
		expect(countedHit(wire, storedOf(wire), TWIN_WINDOW_MS)).toBe(wire)
		expect(countedHit(server, storedOf(server), TWIN_WINDOW_MS)).toBe(server)
	})

	it('leaves every other hit alone', () => {
		const pageview: HitRow = { ...base, id: '01J9ZQ0000000000000000000A', type: 'pageview' }
		expect(countedHits([pageview, wire, server], TWIN_WINDOW_MS).map((hit) => hit.id)).toEqual([
			pageview.id,
			wire.id,
		])
	})
})

describe('twinsWithin', () => {
	it('holds at the window and not a millisecond past it, either way round', () => {
		const at = new Date('2026-10-06T00:00:00.000Z')
		const edge = new Date(at.getTime() + TWIN_WINDOW_MS)
		expect(twinsWithin(at, edge, TWIN_WINDOW_MS)).toBe(true)
		expect(twinsWithin(edge, at, TWIN_WINDOW_MS)).toBe(true)
		expect(twinsWithin(at, new Date(edge.getTime() + 1), TWIN_WINDOW_MS)).toBe(false)
		expect(twinsWithin(at, new Date(0), null)).toBe(true)
	})
})

describe('tombstoneOf', () => {
	it("keeps an order's key, time and sale and clears the visitor and the visit", () => {
		const full: HitRow = {
			...wire,
			item: 'offers:12',
			source: 'news',
			channel: 'email',
			channelVersion: 2,
			city: 'Berlin',
			props: { plan: 'pro' },
		}
		const stone = tombstoneOf(full)
		expect(stone).toEqual({
			id: full.id,
			scope: 'shop',
			ts: full.ts,
			type: 'goal',
			name: 'purchase',
			hostname: 'shop.example',
			path: '/checkout',
			v: '',
			landing: false,
			server: false,
			item: 'offers:12',
			value: 9,
			currency: 'USD',
			goals: [{ slug: 'purchase', value: 9 }],
			conversions: 1,
			revenue: 9,
		})
		expect(holdsVisit(full)).toBe(true)
		expect(holdsVisit(stone)).toBe(false)
		for (const field of TOMBSTONE_CLEARED) {
			expect(stone).not.toHaveProperty(field)
		}
	})
})
