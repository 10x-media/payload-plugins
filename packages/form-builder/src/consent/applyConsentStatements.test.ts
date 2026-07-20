import { describe, expect, it } from 'vitest'
import { applyConsentStatements } from './applyConsentStatements'

const fields = [
	{ blockType: 'text', name: 'email' },
	{ blockType: 'consent', name: 'terms', source: 'privacy' },
]

describe('applyConsentStatements', () => {
	it('merges a resolved statement and link onto the field it names', () => {
		const statement = { root: { children: [] } }
		const result = applyConsentStatements(fields, {
			terms: { statement, link: { label: 'Privacy', url: 'https://x.test/p' } },
		})
		expect(result[1]).toEqual({
			blockType: 'consent',
			name: 'terms',
			source: 'privacy',
			statement,
			link: { label: 'Privacy', url: 'https://x.test/p' },
		})
	})

	it('leaves other fields untouched', () => {
		const result = applyConsentStatements(fields, { terms: { statement: {} } })
		expect(result[0]).toBe(fields[0])
	})

	it('does not mutate the input', () => {
		applyConsentStatements(fields, { terms: { statement: {} } })
		expect(fields[1]).toEqual({ blockType: 'consent', name: 'terms', source: 'privacy' })
	})

	it('leaves a field with no resolved statement alone', () => {
		const result = applyConsentStatements(fields, {})
		expect(result[1]).toBe(fields[1])
	})

	it('skips nameless rows', () => {
		const bare: { blockType: string; name?: string }[] = [{ blockType: 'message' }]
		expect(applyConsentStatements(bare, { terms: { statement: {} } })[0]).toBe(bare[0])
	})
})
