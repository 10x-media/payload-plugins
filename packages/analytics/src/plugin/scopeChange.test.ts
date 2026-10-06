import { describe, expect, it } from 'vitest'
import { docScope } from './scopeChange'

describe('docScope', () => {
	it('reads a plain string scope', () => {
		expect(docScope({ scope: 'tenant-a' }, 'scope')).toBe('tenant-a')
	})

	it('reads the id of a populated relationship', () => {
		expect(docScope({ scope: { id: 'tenant-a', name: 'Tenant A' } }, 'scope')).toBe('tenant-a')
	})

	it('stringifies a numeric id, so both database lanes key the same', () => {
		expect(docScope({ scope: 42 }, 'scope')).toBe('42')
		expect(docScope({ scope: { id: 42 } }, 'scope')).toBe('42')
	})

	// An unscoped install has no scope field at all, and an install-wide row on a scoped
	// install leaves it empty. Both read as null, the value their reads carry.
	it('reads an empty string, an absent field and a non-record document as null', () => {
		expect(docScope({ scope: '' }, 'scope')).toBeNull()
		expect(docScope({ name: 'No scope here' }, 'scope')).toBeNull()
		expect(docScope(null, 'scope')).toBeNull()
		expect(docScope(undefined, 'scope')).toBeNull()
		expect(docScope('tenant-a', 'scope')).toBeNull()
	})

	it('reads a relationship with no usable id as null', () => {
		expect(docScope({ scope: { name: 'Tenant A' } }, 'scope')).toBeNull()
		expect(docScope({ scope: true }, 'scope')).toBeNull()
	})

	it('reads the configured field name rather than a fixed one', () => {
		expect(docScope({ tenant: 'tenant-a', scope: 'other' }, 'tenant')).toBe('tenant-a')
	})
})
