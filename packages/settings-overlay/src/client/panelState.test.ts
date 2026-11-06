import type { ListQuery } from 'payload'
import { describe, expect, it } from 'vitest'

import { CLOSED, parseParam, type State, sameState } from './panelState'

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
})

describe('sameState', () => {
	it('counts a half-built condition, because the filter builder reads it back', () => {
		const half = { where: { or: [{ and: [{ name: { equals: undefined } }] }] } } as ListQuery
		const a: State = { overlayId: 'system', target: { item: 'tags' } }
		const b: State = { overlayId: 'system', target: { item: 'tags', query: half } }
		expect(sameState(a, b)).toBe(false)
	})

	it('separates different targets', () => {
		expect(
			sameState(
				{ overlayId: 'system', target: { item: 'tags' } },
				{ overlayId: 'system', target: { item: 'sites' } }
			)
		).toBe(false)
	})
})
