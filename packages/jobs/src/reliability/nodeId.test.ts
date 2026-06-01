import { describe, expect, it } from 'vitest'

import { resolveNodeId } from './nodeId'

describe('resolveNodeId', () => {
	it('uses an explicit id verbatim', () => {
		expect(resolveNodeId('node-A')).toBe('node-A')
	})

	it('derives a stable hostname:pid id when none is given', () => {
		const id = resolveNodeId(null)
		expect(id).toMatch(/^.+:\d+$/)
		expect(resolveNodeId(null)).toBe(id)
	})
})
