import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveKeys } from './keys'
import {
	AuthenticationFailedError,
	CorruptPlaintextError,
	isSealed,
	MalformedCiphertextError,
	parseWire,
	seal,
	UnknownKeyIdError,
	unseal,
	WIRE_PREFIX,
} from './wire'

const SECRET = 'test-secret-not-for-prod'
const AAD = 'people.ssn'

const ring = await resolveKeys(undefined, SECRET)
const otherRing = await resolveKeys({ active: 'k1', keys: { k1: 'k1-secret-material' } }, SECRET)
const key = ring.dataKeys.get(ring.activeId) as Buffer

const sealValue = (plaintext: unknown, aad = AAD): string =>
	seal({ aad, key, keyId: ring.activeId, plaintext })

describe('seal/unseal round-trip per JS type', () => {
	const cases: [string, unknown][] = [
		['string', 'hello world'],
		['empty string', ''],
		['unicode string', 'grüße 🌍 øß'],
		['integer', 42],
		['zero', 0],
		['negative float', -13.37],
		['boolean true', true],
		['boolean false', false],
		['iso date string', '2026-07-16T12:00:00.000Z'],
		['array of strings', ['a', 'b', 'c']],
		['point tuple', [13.405, 52.52]],
		['object', { nested: { deep: [1, 2, 3] }, tag: 'x' }],
		['lexical state', { root: { children: [{ text: 'secret' }], type: 'root' } }],
	]
	for (const [label, value] of cases) {
		it(`round-trips ${label}`, () => {
			const sealed = sealValue(value)
			expect(isSealed(sealed)).toBe(true)
			expect(sealed.startsWith(`${WIRE_PREFIX}.${ring.activeId}.`)).toBe(true)
			expect(unseal(sealed, ring.dataKeys, [AAD])).toEqual(value)
		})
	}

	it('produces distinct ciphertexts for identical plaintext (random IV)', () => {
		expect(sealValue('same')).not.toBe(sealValue('same'))
	})
})

describe('tamper detection', () => {
	it.each([2, 3, 4])('fails authentication when segment %d is tampered', (index) => {
		const segments = sealValue('sensitive').split('.')
		const original = segments[index] as string
		segments[index] = `${original.slice(0, -2)}${original.endsWith('AA') ? 'BB' : 'AA'}`
		expect(() => unseal(segments.join('.'), ring.dataKeys, [AAD])).toThrow(
			AuthenticationFailedError
		)
	})

	it('routes by keyId and rejects unknown key ids', () => {
		const segments = sealValue('x').split('.')
		segments[1] = 'nope'
		expect(() => unseal(segments.join('.'), ring.dataKeys, [AAD])).toThrow(UnknownKeyIdError)
	})

	it('fails with the wrong key ring', () => {
		const sealed = seal({
			aad: AAD,
			key: otherRing.dataKeys.get('k1') as Buffer,
			keyId: ring.activeId,
			plaintext: 'x',
		})
		expect(() => unseal(sealed, ring.dataKeys, [AAD])).toThrow(AuthenticationFailedError)
	})

	it('fails on AAD mismatch and succeeds on a later candidate', () => {
		const sealed = sealValue('x', 'people.ssn.de')
		expect(() => unseal(sealed, ring.dataKeys, ['people.ssn.en'])).toThrow(
			AuthenticationFailedError
		)
		expect(unseal(sealed, ring.dataKeys, ['people.ssn.en', 'people.ssn.de'])).toBe('x')
	})

	it('reports authenticated-but-non-JSON plaintext as corruption, not auth failure (L1)', () => {
		// Craft a ciphertext that authenticates under the correct key+AAD but whose
		// plaintext is not valid JSON, which seal() (JSON.stringify) can never emit.
		const iv = randomBytes(12)
		const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
		cipher.setAAD(Buffer.from(AAD, 'utf8'))
		const ciphertext = Buffer.concat([
			cipher.update(Buffer.from('not valid json {{{', 'utf8')),
			cipher.final(),
		])
		const tag = cipher.getAuthTag()
		const wire = [
			WIRE_PREFIX,
			ring.activeId,
			iv.toString('base64url'),
			ciphertext.toString('base64url'),
			tag.toString('base64url'),
		].join('.')
		expect(() => unseal(wire, ring.dataKeys, [AAD])).toThrow(CorruptPlaintextError)
		expect(() => unseal(wire, ring.dataKeys, [AAD])).not.toThrow(AuthenticationFailedError)
	})
})

describe('format parsing', () => {
	it('rejects wrong prefix, wrong segment count, bad base64url, bad iv/tag lengths', () => {
		expect(() => parseWire('nope.k0.aa.bb.cc')).toThrow(MalformedCiphertextError)
		expect(() => parseWire('pfe1.k0.aa.bb')).toThrow(MalformedCiphertextError)
		expect(() => parseWire('pfe1.k0.$$.bb.cc')).toThrow(MalformedCiphertextError)
		const short = `pfe1.k0.${Buffer.alloc(4).toString('base64url')}.${Buffer.alloc(8).toString('base64url')}.${Buffer.alloc(16).toString('base64url')}`
		expect(() => parseWire(short)).toThrow(MalformedCiphertextError)
	})

	it('isSealed validates full wire structure, not just the prefix and dot count', () => {
		const structural = `pfe1.k0.${Buffer.alloc(12).toString('base64url')}.${Buffer.alloc(8).toString('base64url')}.${Buffer.alloc(16).toString('base64url')}`
		expect(isSealed(structural)).toBe(true)
		// Prefix + 5 dots but the IV/tag segments are too short: not real ciphertext.
		expect(isSealed('pfe1.k0.aa.bb.cc')).toBe(false)
		expect(isSealed('pfe1.k0.aa.bb')).toBe(false)
		expect(isSealed('plaintext')).toBe(false)
		expect(isSealed(42)).toBe(false)
		expect(isSealed(null)).toBe(false)
	})
})
