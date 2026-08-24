import { describe, expect, it } from 'vitest'
import {
	isReservedHeader,
	isValidHeaderName,
	RESERVED_HEADER_NAMES,
	withoutReservedHeaders,
} from './headers'

describe('isReservedHeader', () => {
	it('matches every header the pipeline sets', () => {
		expect(RESERVED_HEADER_NAMES.every(isReservedHeader)).toBe(true)
	})

	it('ignores case and surrounding whitespace', () => {
		expect(isReservedHeader('Webhook-Signature')).toBe(true)
		expect(isReservedHeader('WEBHOOK-ID')).toBe(true)
		expect(isReservedHeader('  x-webhook-event  ')).toBe(true)
	})

	/**
	 * The body is always JSON.stringify output and the user agent identifies this plugin, so a
	 * subscription that relabels either mislabels every delivery it sends.
	 */
	it('covers the two headers a custom value would silently mislabel', () => {
		expect(isReservedHeader('Content-Type')).toBe(true)
		expect(isReservedHeader('User-Agent')).toBe(true)
	})

	it('leaves unrelated headers alone', () => {
		expect(isReservedHeader('X-Custom')).toBe(false)
		expect(isReservedHeader('Authorization')).toBe(false)
		expect(isReservedHeader('webhook-signature-hint')).toBe(false)
	})
})

describe('withoutReservedHeaders', () => {
	it('drops a header that would clobber the signature', () => {
		expect(withoutReservedHeaders({ 'Webhook-Signature': 'v1,forged', 'X-Ok': '1' })).toEqual({
			'X-Ok': '1',
		})
	})

	it('drops every reserved name regardless of case', () => {
		const custom = Object.fromEntries(
			RESERVED_HEADER_NAMES.map((name) => [name.toUpperCase(), 'x'])
		)
		expect(withoutReservedHeaders(custom)).toBeUndefined()
	})

	it('passes unrelated headers through untouched', () => {
		const custom = { 'X-A': '1', 'X-B': '2' }
		expect(withoutReservedHeaders(custom)).toEqual(custom)
	})

	it('handles an absent header map', () => {
		expect(withoutReservedHeaders(undefined)).toBeUndefined()
		expect(withoutReservedHeaders({})).toBeUndefined()
	})
})

describe('isValidHeaderName', () => {
	it('accepts an RFC 9110 token', () => {
		expect(isValidHeaderName('X-Custom')).toBe(true)
		expect(isValidHeaderName('X_Custom.1')).toBe(true)
		expect(isValidHeaderName("!#$%&'*+-.^_`|~0aZ")).toBe(true)
	})

	it('ignores surrounding whitespace, which is trimmed before use', () => {
		expect(isValidHeaderName('  X-Custom  ')).toBe(true)
	})

	/** These save fine and then make `fetch` throw at delivery time. */
	it('rejects a name that is not a token', () => {
		for (const name of ['X Custom', 'X:Custom', 'X	Custom', 'Ünicode', '']) {
			expect(isValidHeaderName(name)).toBe(false)
		}
	})
})
