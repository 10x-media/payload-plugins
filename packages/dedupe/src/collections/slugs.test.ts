import { describe, expect, it } from 'vitest'

import { PAGE_SIZE, pageSize } from './slugs'

describe('pageSize', () => {
	it('reads a page size from the address as the list uses it, 1 to 100', () => {
		expect(pageSize(null)).toBe(PAGE_SIZE)
		expect(pageSize('abc')).toBe(PAGE_SIZE)
		expect(pageSize('50')).toBe(50)
		expect(pageSize('500')).toBe(100)
		expect(pageSize('-3')).toBe(1)
	})
})
