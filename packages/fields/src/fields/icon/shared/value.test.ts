import { describe, expect, it } from 'vitest'
import { formatIconValue, parseIconValue, resolveIconValue } from './value'

describe('icon value', () => {
	it('parses prefixed values', () => {
		expect(parseIconValue('lucide:house')).toEqual({ library: 'lucide', name: 'house' })
	})

	it('parses bare legacy values with a null library', () => {
		expect(parseIconValue('house')).toEqual({ library: null, name: 'house' })
	})

	it('splits only on the first colon', () => {
		expect(parseIconValue('a:b:c')).toEqual({ library: 'a', name: 'b:c' })
	})

	it('formats values', () => {
		expect(formatIconValue('tabler', 'heart')).toBe('tabler:heart')
	})

	it('resolves bare values against the default library', () => {
		expect(resolveIconValue('house', 'lucide')).toEqual({ library: 'lucide', name: 'house' })
		expect(resolveIconValue('radix:cube', 'lucide')).toEqual({ library: 'radix', name: 'cube' })
	})
})
