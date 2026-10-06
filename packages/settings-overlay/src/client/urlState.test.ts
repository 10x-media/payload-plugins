import type { ListQuery } from 'payload'
import { describe, expect, it } from 'vitest'

import {
	CLOSED,
	formatParam,
	formatQueryParam,
	parseParam,
	parseQueryParam,
	pruneWhereForUrl,
	type State,
	sameState,
	sameUrlState,
} from './urlState'

describe('parseParam', () => {
	it('reads overlay, item and id', () => {
		expect(parseParam('system/communities/abc')).toEqual({
			overlayId: 'system',
			target: { id: 'abc', item: 'communities' },
		})
	})

	it('reads an overlay on its own', () => {
		expect(parseParam('system')).toEqual({ overlayId: 'system', target: {} })
	})

	it('reads an absent or empty value as closed', () => {
		expect(parseParam(null)).toEqual(CLOSED)
		expect(parseParam('')).toEqual(CLOSED)
		expect(parseParam('/communities')).toEqual(CLOSED)
	})

	it('reads a value it cannot decode as closed rather than throwing', () => {
		expect(parseParam('system/100%')).toEqual(CLOSED)
	})

	it('decodes each segment', () => {
		expect(parseParam('system/my%2Fitem')).toEqual({
			overlayId: 'system',
			target: { item: 'my/item' },
		})
	})

	it('merges the list query only while a list is shown', () => {
		const query = JSON.stringify({ limit: 20 })
		expect(parseParam('system/tags', query).target.query).toEqual({ limit: 20 })
		expect(parseParam('system/tags/abc', query).target.query).toBeUndefined()
	})
})

describe('formatParam', () => {
	it('round-trips a full target', () => {
		const state: State = { overlayId: 'system', target: { id: 'abc', item: 'communities' } }
		expect(formatParam(state)).toBe('system/communities/abc')
	})

	it('drops an id with no item rather than writing a hole', () => {
		expect(formatParam({ overlayId: 'system', target: { id: 'abc' } })).toBe('system/abc')
	})

	it('is null when nothing is open', () => {
		expect(formatParam(CLOSED)).toBeNull()
	})

	it('encodes segments', () => {
		expect(formatParam({ overlayId: 'system', target: { item: 'my/item' } })).toBe(
			'system/my%2Fitem'
		)
	})
})

describe('parseQueryParam', () => {
	it('reads an object', () => {
		expect(parseQueryParam('{"limit":10}')).toEqual({ limit: 10 })
	})

	it('reads anything else as no query', () => {
		expect(parseQueryParam(null)).toBeUndefined()
		expect(parseQueryParam('[]')).toBeUndefined()
		expect(parseQueryParam('7')).toBeUndefined()
		expect(parseQueryParam('not json')).toBeUndefined()
	})
})

describe('pruneWhereForUrl', () => {
	it('keeps complete conditions', () => {
		const where = { or: [{ and: [{ name: { equals: 'x' } }] }] }
		expect(pruneWhereForUrl(where)).toEqual(where)
	})

	it('drops a half-built condition and the group it emptied', () => {
		const where = { or: [{ and: [{ name: { equals: undefined } }] }] }
		expect(pruneWhereForUrl(where)).toBeUndefined()
	})

	it('drops a condition with no operators at all', () => {
		const where = { or: [{ and: [{ name: {} }, { title: { equals: 'kept' } }] }] }
		expect(pruneWhereForUrl(where)).toEqual({ or: [{ and: [{ title: { equals: 'kept' } }] }] })
	})

	it('leaves a where with no `or` alone', () => {
		expect(pruneWhereForUrl({ name: { equals: 'x' } })).toEqual({ name: { equals: 'x' } })
	})
})

describe('formatQueryParam', () => {
	it('is null for an empty query', () => {
		expect(formatQueryParam(undefined)).toBeNull()
		expect(formatQueryParam({} as ListQuery)).toBeNull()
	})

	it('prunes the where before writing', () => {
		const query = { where: { or: [{ and: [{ name: { equals: undefined } }] }] } } as ListQuery
		expect(formatQueryParam(query)).toBeNull()
	})

	it('keeps the rest of the query beside a pruned where', () => {
		const query = {
			limit: 5,
			where: { or: [{ and: [{ name: { equals: undefined } }] }] },
		} as unknown as ListQuery
		expect(formatQueryParam(query)).toBe('{"limit":5}')
	})
})

describe('state equality', () => {
	const half = { where: { or: [{ and: [{ name: { equals: undefined } }] }] } } as ListQuery

	it('sameState counts a half-built condition, because memory holds it', () => {
		const a: State = { overlayId: 'system', target: { item: 'tags' } }
		const b: State = { overlayId: 'system', target: { item: 'tags', query: half } }
		expect(sameState(a, b)).toBe(false)
	})

	it('sameUrlState ignores it, because the URL never carried it', () => {
		const a: State = { overlayId: 'system', target: { item: 'tags' } }
		const b: State = { overlayId: 'system', target: { item: 'tags', query: half } }
		expect(sameUrlState(a, b)).toBe(true)
	})

	it('sameUrlState separates different targets', () => {
		expect(
			sameUrlState(
				{ overlayId: 'system', target: { item: 'tags' } },
				{ overlayId: 'system', target: { item: 'sites' } }
			)
		).toBe(false)
	})
})
