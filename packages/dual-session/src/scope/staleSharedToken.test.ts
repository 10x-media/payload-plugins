import { describe, expect, it } from 'vitest'

import { isStaleSharedToken, readCollectionClaim, withoutCookie } from './staleSharedToken'

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

const jwt = (claims: Record<string, unknown>) =>
	`${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`

describe('readCollectionClaim', () => {
	it('reads the collection claim without the secret', () => {
		expect(readCollectionClaim(jwt({ collection: 'customers', id: '1' }))).toBe('customers')
	})

	it('decodes a base64url body that needs padding and uses url-safe characters', () => {
		// `?>` encodes to `Pz4`, which standard base64 spells with no `-` or `_`; `~~~` gives
		// `fn5-`, exercising the url-safe alphabet.
		expect(readCollectionClaim(jwt({ collection: 'customers', note: '~~~?>' }))).toBe('customers')
	})

	it('answers undefined for anything that is not a readable JWT', () => {
		expect(readCollectionClaim('not-a-jwt')).toBeUndefined()
		expect(readCollectionClaim('a.%%%.c')).toBeUndefined()
		expect(readCollectionClaim(jwt({ id: '1' }))).toBeUndefined()
		expect(readCollectionClaim(jwt({ collection: 7 }))).toBeUndefined()
	})
})

describe('isStaleSharedToken', () => {
	it('flags a token of a listed collection', () => {
		expect(isStaleSharedToken(jwt({ collection: 'customers' }), ['customers'])).toBe(true)
	})

	it('leaves the admin collection and missing tokens alone', () => {
		expect(isStaleSharedToken(jwt({ collection: 'users' }), ['customers'])).toBe(false)
		expect(isStaleSharedToken(undefined, ['customers'])).toBe(false)
		expect(isStaleSharedToken('', ['customers'])).toBe(false)
	})
})

describe('withoutCookie', () => {
	it('removes only the named cookie', () => {
		const headers = new Headers({
			Cookie: 'payload-token=abc; payload-customers-token=def; theme=dark',
		})

		expect(withoutCookie(headers, 'payload-token').get('Cookie')).toBe(
			'payload-customers-token=def; theme=dark'
		)
	})

	it('drops the header when nothing is left', () => {
		expect(
			withoutCookie(new Headers({ Cookie: 'payload-token=abc' }), 'payload-token').has('Cookie')
		).toBe(false)
	})

	it('does not match a cookie whose name merely starts the same', () => {
		const headers = new Headers({ Cookie: 'payload-token-legacy=1' })

		expect(withoutCookie(headers, 'payload-token').get('Cookie')).toBe('payload-token-legacy=1')
	})

	it('keeps the other headers and leaves the input untouched', () => {
		const headers = new Headers({ Cookie: 'payload-token=abc', Referer: 'https://site.test/' })
		const next = withoutCookie(headers, 'payload-token')

		expect(next.get('Referer')).toBe('https://site.test/')
		expect(headers.get('Cookie')).toBe('payload-token=abc')
	})
})
