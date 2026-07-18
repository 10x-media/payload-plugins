import { describe, expect, it } from 'vitest'
import { getAtPath, setAtPath } from './pageThrough'

describe('getAtPath', () => {
	it('reads a top-level key', () => {
		expect(getAtPath({ secret: 'value' }, 'secret')).toBe('value')
	})

	it('reads a nested group.secret key', () => {
		expect(getAtPath({ group: { secret: 'value' } }, 'group.secret')).toBe('value')
	})

	it('returns undefined for a missing path', () => {
		expect(getAtPath({ group: {} }, 'group.secret')).toBeUndefined()
		expect(getAtPath({}, 'group.secret')).toBeUndefined()
	})
})

describe('setAtPath', () => {
	it('creates a nested group.secret structure from an empty object', () => {
		const target: Record<string, unknown> = {}
		setAtPath(target, 'group.secret', 'value')
		expect(target).toEqual({ group: { secret: 'value' } })
	})

	it('overwrites an existing nested value without clobbering siblings', () => {
		const target: Record<string, unknown> = { group: { other: 'keep', secret: 'old' } }
		setAtPath(target, 'group.secret', 'new')
		expect(target).toEqual({ group: { other: 'keep', secret: 'new' } })
	})
})
