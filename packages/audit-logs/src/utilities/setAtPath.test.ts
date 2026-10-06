import { describe, expect, it } from 'vitest'

import { getAtPath, setAtPath } from './setAtPath'

describe('getAtPath', () => {
	it('reads a nested value', () => {
		expect(getAtPath({ meta: { author: 7 } }, 'meta.author')).toBe(7)
	})

	it('returns undefined instead of throwing on a missing branch', () => {
		expect(getAtPath({}, 'meta.author')).toBeUndefined()
		expect(getAtPath({ meta: null }, 'meta.author')).toBeUndefined()
		expect(getAtPath({ meta: 'text' }, 'meta.author')).toBeUndefined()
	})

	it('reads a top-level value', () => {
		expect(getAtPath({ author: 7 }, 'author')).toBe(7)
	})
})

describe('setAtPath', () => {
	it('writes a top-level value', () => {
		const doc: Record<string, unknown> = {}
		setAtPath(doc, 'author', 7)
		expect(doc).toEqual({ author: 7 })
	})

	it('creates the branches it needs', () => {
		const doc: Record<string, unknown> = {}
		setAtPath(doc, 'meta.audit.author', 7)
		expect(doc).toEqual({ meta: { audit: { author: 7 } } })
	})

	it('keeps siblings on the way down', () => {
		const doc: Record<string, unknown> = { meta: { title: 'kept' } }
		setAtPath(doc, 'meta.author', 7)
		expect(doc).toEqual({ meta: { title: 'kept', author: 7 } })
	})

	it('replaces a non-object standing where a branch has to go', () => {
		const doc: Record<string, unknown> = { meta: 'text' }
		setAtPath(doc, 'meta.author', 7)
		expect(doc).toEqual({ meta: { author: 7 } })
	})

	it('overwrites an existing value', () => {
		const doc: Record<string, unknown> = { author: 1 }
		setAtPath(doc, 'author', 2)
		expect(doc.author).toBe(2)
	})
})
