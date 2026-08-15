import { describe, expect, it } from 'vitest'
import { generateSecret } from '../secrets/format'
import { fromCollectionRow } from './resolveSubscriptions'

const NOW = Date.parse('2026-01-01T00:00:00.000Z')
const current = generateSecret()
const previous = generateSecret()

const row = (overrides: Record<string, unknown> = {}) => ({
	id: 1,
	url: 'https://x',
	secret: current,
	previousSecret: previous,
	...overrides,
})

describe('rotation grace window', () => {
	it('signs with both secrets while the window is open, active first', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW + 60_000).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([current, previous])
	})

	it('drops the previous secret once the window closes', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW - 1).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([current])
	})

	it('treats the expiry instant itself as closed', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([current])
	})

	it('accepts a Date expiry as stored by postgres drivers', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW + 60_000) }),
			NOW
		)
		expect(resolved.secrets).toEqual([current, previous])
	})

	it('ignores a previous secret with no expiry', () => {
		expect(fromCollectionRow(row({ previousSecretExpiresAt: null }), NOW).secrets).toEqual([
			current,
		])
		expect(fromCollectionRow(row(), NOW).secrets).toEqual([current])
	})

	it('ignores an unparseable expiry rather than signing forever', () => {
		const resolved = fromCollectionRow(row({ previousSecretExpiresAt: 'not-a-date' }), NOW)
		expect(resolved.secrets).toEqual([current])
	})

	it('drops a masked previous secret inside an open window', () => {
		const resolved = fromCollectionRow(
			row({
				previousSecret: '__redacted__',
				previousSecretExpiresAt: new Date(NOW + 60_000).toISOString(),
			}),
			NOW
		)
		expect(resolved.secrets).toEqual([current])
	})

	it('still signs with the previous secret when the current one is unreadable', () => {
		const resolved = fromCollectionRow(
			row({ secret: null, previousSecretExpiresAt: new Date(NOW + 60_000).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([previous])
	})
})
