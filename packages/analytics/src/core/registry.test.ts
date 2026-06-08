import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../testing/memoryAdapter'
import { createRegistry } from './registry'

describe('createRegistry', () => {
	it('resolves an adapter by id and exposes the default', () => {
		const a = memoryAdapter()
		const reg = createRegistry([a], 'memory')
		expect(reg.get('memory')).toBe(a)
		expect(reg.default()).toBe(a)
		expect(reg.isMultiProvider()).toBe(false)
	})
	it('flags multi-provider and defaults to the first adapter', () => {
		const a = { ...memoryAdapter(), id: 'a' }
		const b = { ...memoryAdapter(), id: 'b' }
		const reg = createRegistry([a, b])
		expect(reg.default().id).toBe('a')
		expect(reg.isMultiProvider()).toBe(true)
	})
	it('throws on an unknown id', () => {
		expect(() => createRegistry([memoryAdapter()]).get('nope')).toThrow(/unknown adapter/i)
	})
	it('throws on an unknown default adapter id', () => {
		expect(() => createRegistry([memoryAdapter()], 'nope')).toThrow(/unknown default adapter/i)
	})
})
