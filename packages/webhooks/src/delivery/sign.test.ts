import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SECRET_PREFIX } from '../constants'
import { generateSecret } from '../secrets/format'
import { signatureHeader, signPayload } from './sign'

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

describe('signPayload', () => {
	// Canonical base64 over fixed bytes: deterministic, and the encoding normalizeSecret accepts.
	const secret = `${SECRET_PREFIX}${Buffer.alloc(32, 7).toString('base64')}`
	const args = { secret, id: 'msg_1', timestamp: 1_700_000_000, body: '{"a":1}' }

	it('signs id.timestamp.body with HMAC-SHA256 over the base64-decoded key', () => {
		const key = Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64')
		const expected = createHmac('sha256', key)
			.update(`${args.id}.${args.timestamp}.${args.body}`)
			.digest('base64')
		expect(signPayload(args)).toBe(expected)
	})

	it('emits base64, not hex', () => {
		expect(signPayload(args)).toMatch(BASE64)
		expect(Buffer.from(signPayload(args), 'base64')).toHaveLength(32)
	})

	it('strips the whsec_ prefix before deriving the key', () => {
		const bare = secret.slice(SECRET_PREFIX.length)
		expect(signPayload({ ...args, secret: `${SECRET_PREFIX}${bare}` })).toBe(
			createHmac('sha256', Buffer.from(bare, 'base64'))
				.update(`${args.id}.${args.timestamp}.${args.body}`)
				.digest('base64')
		)
	})

	it('does not key the HMAC with the undecoded secret string', () => {
		const asAscii = createHmac('sha256', secret.slice(SECRET_PREFIX.length))
			.update(`${args.id}.${args.timestamp}.${args.body}`)
			.digest('base64')
		expect(signPayload(args)).not.toBe(asAscii)
	})

	it('changes when any input changes', () => {
		const base = signPayload(args)
		expect(signPayload({ ...args, id: 'msg_2' })).not.toBe(base)
		expect(signPayload({ ...args, body: '{"a":2}' })).not.toBe(base)
		expect(signPayload({ ...args, timestamp: args.timestamp + 1 })).not.toBe(base)
		expect(signPayload({ ...args, secret: generateSecret() })).not.toBe(base)
	})

	it('rejects a secret that is not valid whsec_ material', () => {
		expect(() => signPayload({ ...args, secret: 'not-a-secret' })).toThrow(/invalid signing secret/)
	})

	it('signs the exact body bytes, including whitespace and unicode', () => {
		const body = '{ "t": "café — \\n" }'
		const key = Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64')
		expect(signPayload({ ...args, body })).toBe(
			createHmac('sha256', key).update(`${args.id}.${args.timestamp}.${body}`).digest('base64')
		)
	})
})

describe('signatureHeader', () => {
	it('tags a single signature with the v1 scheme', () => {
		expect(signatureHeader(['abc'])).toBe('v1,abc')
	})

	it('space-separates multiple signatures', () => {
		expect(signatureHeader(['new', 'old'])).toBe('v1,new v1,old')
	})

	it('round-trips through the header shape a verifier parses', () => {
		const signatures = [1, 2].map(() =>
			signPayload({ secret: generateSecret(), id: 'm', timestamp: 1, body: '{}' })
		)
		const parsed = signatureHeader(signatures)
			.split(' ')
			.map((part) => part.split(','))
		expect(parsed.every(([version]) => version === 'v1')).toBe(true)
		expect(parsed.map(([, signature]) => signature)).toEqual(signatures)
	})

	it('produces a signature over random key material that verifies against a manual HMAC', () => {
		const raw = randomBytes(32)
		const secret = `${SECRET_PREFIX}${raw.toString('base64')}`
		expect(signPayload({ secret, id: 'm', timestamp: 7, body: 'x' })).toBe(
			createHmac('sha256', raw).update('m.7.x').digest('base64')
		)
	})
})
