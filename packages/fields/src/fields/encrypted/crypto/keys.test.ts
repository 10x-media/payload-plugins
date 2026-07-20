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

	it('rejects a secret below the minimum byte length', async () => {
		await expect(resolveKeys(undefined, 'too-short')).rejects.toBeInstanceOf(InvalidKeysConfigError)
	})

	it('accepts a secret at the minimum byte length', async () => {
		const ring = await resolveKeys(undefined, 'sixteen-byte-key')
		expect(ring.dataKeys.get(DEFAULT_KEY_ID)?.length).toBe(32)
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

	it('derives the index key from the root secret (fallback), not the active data key (H2)', async () => {
		const ring = await resolveKeys({ active: 'k1', keys: { k1: 'k1-secret-material' } }, SECRET)
		expect(ring.indexKey.length).toBe(32)
		expect(ring.indexKey.equals(ring.dataKeys.get('k1') as Buffer)).toBe(false)
		// Same derivation as the default ring's index key: both come from the secret.
		expect(ring.indexKey.toString('hex')).toBe(
			'51763f29ad9fb674658f44ca197915a4a18026f417820f79a5710857656cffc1'
		)
	})

	it('keeps the index key stable when the active data key changes (H2 blind-index integrity)', async () => {
		const keys = { k1: 'old-key-material-v1', k2: 'new-key-material-v2' }
		const before = await resolveKeys({ active: 'k1', keys }, SECRET)
		const after = await resolveKeys({ active: 'k2', keys }, SECRET)
		expect(after.activeId).toBe('k2')
		expect(after.dataKeys.get('k2')?.equals(before.dataKeys.get('k2') as Buffer)).toBe(true)
		// Rotating the active data key must NOT change the index key.
		expect(after.indexKey.equals(before.indexKey)).toBe(true)
	})

	it('uses dedicated KeysConfig.indexKey material when provided (H2)', async () => {
		const ring = await resolveKeys(
			{
				active: 'k1',
				indexKey: 'dedicated-index-key-material',
				keys: { k1: 'k1-secret-material' },
			},
			SECRET
		)
		expect(ring.indexKey.toString('hex')).toBe(
			'a414f1825f41c915d6678a519ed178805462affeb2e9012ab9c03bbd78b41a18'
		)
		// Distinct from the secret-derived default so a rotation strategy can pin it.
		expect(ring.indexKey.toString('hex')).not.toBe(
			'51763f29ad9fb674658f44ca197915a4a18026f417820f79a5710857656cffc1'
		)
	})

	it('rejects indexKey material below the minimum byte length (H2)', () => {
		expect(() =>
			validateKeysConfig({ active: 'k1', indexKey: 'short', keys: { k1: 'k1-secret-material' } })
		).toThrow(InvalidKeysConfigError)
	})

	it('keeps every configured key decryptable while only active encrypts', async () => {
		const ring = await resolveKeys(
			{ active: 'k2', keys: { k1: 'old-key-material-v1', k2: 'new-key-material-v2' } },
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

	it('rejects string material below the minimum byte length (M1)', async () => {
		expect(() => validateKeysConfig({ active: 'k1', keys: { k1: 'x' } })).toThrow(
			InvalidKeysConfigError
		)
		expect(() => validateKeysConfig({ active: 'k1', keys: { k1: '   ' } })).toThrow(
			InvalidKeysConfigError
		)
		await expect(resolveKeys({ active: 'k1', keys: { k1: 'x' } }, SECRET)).rejects.toBeInstanceOf(
			InvalidKeysConfigError
		)
	})

	it('accepts string material at or above the minimum byte length (M1)', async () => {
		expect(() =>
			validateKeysConfig({ active: 'k1', keys: { k1: 'sixteen-byte-key' } })
		).not.toThrow()
		const ring = await resolveKeys({ active: 'k1', keys: { k1: 'sixteen-byte-key' } }, SECRET)
		expect(ring.dataKeys.get('k1')?.length).toBe(32)
	})

	it('rejects a provider returning a short Uint8Array (M1)', async () => {
		await expect(
			resolveKeys({ active: 'k1', keys: { k1: async () => new Uint8Array(8) } }, SECRET)
		).rejects.toBeInstanceOf(InvalidKeysConfigError)
	})

	it('rejects a provider that returns a string instead of Uint8Array (L3)', async () => {
		const stringProvider = (async () =>
			'a-string-longer-than-sixteen-bytes') as unknown as () => Promise<Uint8Array>
		await expect(
			resolveKeys({ active: 'k1', keys: { k1: stringProvider } }, SECRET)
		).rejects.toBeInstanceOf(InvalidKeysConfigError)
	})
})
