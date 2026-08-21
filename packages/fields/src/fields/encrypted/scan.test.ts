import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { encryptedField } from './encryptedField'
import { scanEncryptedFields } from './scan'

const secret = (name: string): Field[] =>
	encryptedField({ name, type: 'text' }, { protection: 'writeOnly' })

describe('scanEncryptedFields', () => {
	it('finds a top-level encrypted field by name', () => {
		const paths = [...scanEncryptedFields(secret('apiKey')).keys()]
		expect(paths).toContain('apiKey')
	})

	it('addresses fields inside named groups and tabs by dot path', () => {
		const fields: Field[] = [
			{ name: 'auth', type: 'group', fields: secret('password') },
			{
				type: 'tabs',
				tabs: [
					{ name: 'billing', fields: secret('token') },
					{ fields: secret('loose'), label: 'Unnamed' },
				],
			},
			{ type: 'row', fields: secret('inRow') },
		]
		const paths = [...scanEncryptedFields(fields).keys()]
		expect(paths).toEqual(
			expect.arrayContaining(['auth.password', 'billing.token', 'loose', 'inRow'])
		)
	})

	it('returns an empty map for a schema with no fields', () => {
		expect(scanEncryptedFields(undefined).size).toBe(0)
	})

	it('reuses the scan for the same field array', () => {
		const fields = secret('apiKey')
		expect(scanEncryptedFields(fields)).toBe(scanEncryptedFields(fields))
	})

	it('keeps two schemas apart even when their fields look identical', () => {
		const first = secret('apiKey')
		const second = [...secret('apiKey'), ...secret('other')]
		expect(scanEncryptedFields(first)).not.toBe(scanEncryptedFields(second))
		expect(scanEncryptedFields(first).size).toBe(1)
		expect(scanEncryptedFields(second).size).toBe(2)
	})
})
