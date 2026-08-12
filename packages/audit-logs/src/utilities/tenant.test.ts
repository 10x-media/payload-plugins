import { describe, expect, it } from 'vitest'

import { extractTenantId } from './tenant'

describe('extractTenantId', () => {
	it('passes an unpopulated id straight through', () => {
		expect(extractTenantId('tenant-1')).toBe('tenant-1')
		expect(extractTenantId(4)).toBe(4)
	})

	it('reads the id out of a populated relationship', () => {
		expect(extractTenantId({ id: 4, name: 'Acme' })).toBe(4)
	})

	it('is null when there is no tenant to record', () => {
		expect(extractTenantId(null)).toBeNull()
		expect(extractTenantId(undefined)).toBeNull()
		expect(extractTenantId({ name: 'Acme' })).toBeNull()
		expect(extractTenantId(true)).toBeNull()
	})
})
