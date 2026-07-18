import { describe, expect, it } from 'vitest'
import { DEFAULT_KEY_ID, InvalidKeysConfigError, resolveKeys, validateKeysConfig } from './keys'

const SECRET = 'test-secret-not-for-prod'

describe('resolveKeys: default ring', () => {
	it('derives deterministic HKDF-SHA256 keys from the secret (RFC5869 golden vectors)', async () => {
		const ring = await resolveKeys(undefined, SECRET)
		expect(ring.activeId).toBe(DEFAULT_KEY_ID)
		// Vectors computed once with node:crypto hkdfSync('sha256', ikm, salt, info, 32)
		// where salt = '@10x-media/fields/encrypted' (utf8) and ikm = SECRET (utf8).
		expect(ring.dataKeys.get(DEFAULT_KEY_ID)?.toString('hex')).toBe(
			'b6e0b4a116ce707dedcbaa798caee157825e731a292d4cfb8e0983a0ccca7555'
		)
		expect(ring.indexKey.toString('hex')).toBe(
			'51763f29ad9fb674658f44ca197915a4a18026f417820f79a5710857656cffc1'
		)
	})

	it('caches the default ring per secret', async () => {
		const a = await resolveKeys(undefined, SECRET)
		const b = await resolveKeys(undefined, SECRET)
		expect(a).toBe(b)
	})

	it('rejects an empty secret', async () => {
		await expect(resolveKeys(undefined, '')).rejects.toBeInstanceOf(InvalidKeysConfigError)
	})
})

describe('resolveKeys: custom KeysConfig', () => {
	it('derives 32-byte keys from string material via HKDF (golden vector)', async () => {
		const ring = await resolveKeys({ active: 'k1', keys: { k1: 'k1-secret-material' } }, SECRET)
		expect(ring.activeId).toBe('k1')
		expect(ring.dataKeys.get('k1')?.length).toBe(32)
		expect(ring.dataKeys.get('k1')?.toString('hex')).toBe(
			'a905e187a4ed93073469d6cf1196f860bb0d6150dd65589156c3c4a1a37096a0'
		)
	})

	it('supports async Uint8Array providers, resolved once and cached', async () => {
		let calls = 0
		const provider = async (): Promise<Uint8Array> => {
			calls += 1
			return new Uint8Array(32).fill(7)
		}
		const config = { active: 'kms', keys: { kms: provider } }
		const first = await resolveKeys(config, SECRET)
		const second = await resolveKeys(config, SECRET)
		expect(first).toBe(second)
		expect(calls).toBe(1)
		expect(first.dataKeys.get('kms')?.length).toBe(32)
	})

	it('derives the index key from the ACTIVE key material with the bidx info string', async () => {
		const ring = await resolveKeys({ active: 'k1', keys: { k1: 'k1-secret-material' } }, SECRET)
		expect(ring.indexKey.length).toBe(32)
		expect(ring.indexKey.equals(ring.dataKeys.get('k1') as Buffer)).toBe(false)
	})

	it('keeps every configured key decryptable while only active encrypts', async () => {
		const ring = await resolveKeys(
			{ active: 'k2', keys: { k1: 'old-material', k2: 'new-material' } },
			SECRET
		)
		expect(ring.activeId).toBe('k2')
		expect(ring.dataKeys.has('k1')).toBe(true)
		expect(ring.dataKeys.has('k2')).toBe(true)
	})

	it('rejects an active id missing from keys', () => {
		expect(() => validateKeysConfig({ active: 'k9', keys: { k1: 'x' } })).toThrow(
			InvalidKeysConfigError
		)
	})

	it('rejects key ids containing wire-format delimiters or exotic characters', () => {
		expect(() => validateKeysConfig({ active: 'k.1', keys: { 'k.1': 'x' } })).toThrow(
			InvalidKeysConfigError
		)
		expect(() => validateKeysConfig({ active: 'k 1', keys: { 'k 1': 'x' } })).toThrow(
			InvalidKeysConfigError
		)
	})

	it('rejects empty string material and empty provider output', async () => {
		expect(() => validateKeysConfig({ active: 'k1', keys: { k1: '' } })).toThrow(
			InvalidKeysConfigError
		)
		await expect(
			resolveKeys({ active: 'k1', keys: { k1: async () => new Uint8Array(0) } }, SECRET)
		).rejects.toBeInstanceOf(InvalidKeysConfigError)
	})
})
