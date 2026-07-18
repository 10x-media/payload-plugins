import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolveKeys } from './crypto/keys'
import { isSealed, seal, unseal } from './crypto/wire'
import { makeBeforeChangeHook, readAadCandidates, sealAad } from './hooks'
import { ENCRYPTED_CONTEXT_KEY, type EncryptedFieldMarker } from './types'
import { makeComposedValidate } from './validators'

const SECRET = 'test-secret-not-for-prod'

const marker = (localized: boolean): EncryptedFieldMarker => ({
	fieldName: 'ssn',
	hasMany: false,
	localized,
	normalize: 'standard',
	queryable: false,
	sourceType: 'text',
})

const makeReq = (
	locale: string | undefined,
	localization: false | { defaultLocale: string; localeCodes: string[] }
): PayloadRequest =>
	({ locale, payload: { config: { localization } } }) as unknown as PayloadRequest

describe('sealAad binds slug.field[.locale] through buildAad', () => {
	it('non-localized fields bind slug.field', () => {
		expect(sealAad(marker(false), 'users', makeReq(undefined, false))).toBe('users.ssn')
	})

	it('localized fields append the request locale', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(sealAad(marker(true), 'users', makeReq('de', loc))).toBe('users.ssn.de')
	})

	it('localized fields fall back to the default locale when the request locale is all', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(sealAad(marker(true), 'users', makeReq('all', loc))).toBe('users.ssn.en')
	})
})

describe('readAadCandidates (Deviation 3: request locale first, then every configured locale)', () => {
	it('non-localized fields yield the single slug.field candidate', () => {
		expect(readAadCandidates(marker(false), 'users', makeReq(undefined, false))).toEqual([
			'users.ssn',
		])
	})

	it('localized fields try the request locale first, then the rest in config order', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(readAadCandidates(marker(true), 'users', makeReq('de', loc))).toEqual([
			'users.ssn.de',
			'users.ssn.en',
			'users.ssn.fr',
		])
	})

	it('locale=all reads try the default locale first', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(readAadCandidates(marker(true), 'users', makeReq('all', loc))).toEqual([
			'users.ssn.en',
			'users.ssn.de',
			'users.ssn.fr',
		])
	})
})

type SealMarker = Partial<EncryptedFieldMarker> & Pick<EncryptedFieldMarker, 'fieldName'>

const sealMarker = (overrides: SealMarker): EncryptedFieldMarker => ({
	hasMany: false,
	localized: false,
	normalize: 'standard',
	queryable: false,
	sourceType: 'text',
	...overrides,
})

const hookReq = (locale?: string): PayloadRequest =>
	({
		context: {},
		locale,
		payload: { config: { localization: false, secret: SECRET } },
	}) as unknown as PayloadRequest

const callSeal = (m: EncryptedFieldMarker, value: unknown, req: PayloadRequest) => {
	const hook = makeBeforeChangeHook(m)
	const siblingData: Record<string, unknown> = {}
	const result = hook({
		collection: { slug: 'users' },
		global: null,
		operation: 'update',
		path: [m.fieldName],
		req,
		siblingData,
		value,
	} as unknown as Parameters<typeof hook>[0])
	return { result, siblingData }
}

describe('makeBeforeChangeHook seal behavior (real crypto)', () => {
	it('seals a hasMany array per item, leaving already-sealed items byte-identical (H1)', async () => {
		const ring = await resolveKeys(undefined, SECRET)
		const aad = 'users.tags'
		const existing = seal({
			aad,
			key: ring.dataKeys.get('k0') as Buffer,
			keyId: 'k0',
			plaintext: 'existing',
		})
		const out = (await callSeal(
			sealMarker({ fieldName: 'tags', hasMany: true }),
			[existing, 'fresh'],
			hookReq()
		).result) as unknown[]
		// The already-sealed item is passed through, not wrapped in a second layer.
		expect(out[0]).toBe(existing)
		expect(isSealed(out[1])).toBe(true)
		expect(out[1]).not.toBe(existing)
		// Both open with a single unseal: no double encryption.
		expect(unseal(out[0] as string, ring.dataKeys, [aad])).toBe('existing')
		expect(unseal(out[1] as string, ring.dataKeys, [aad])).toBe('fresh')
	})

	it('clears the blind index in decrypt mode and passes the value through (L5)', async () => {
		const ring = await resolveKeys(undefined, SECRET)
		const sealed = seal({
			aad: 'users.ssn',
			key: ring.dataKeys.get('k0') as Buffer,
			keyId: 'k0',
			plaintext: 'x@y.com',
		})
		const req = hookReq()
		;(req.context as Record<string, unknown>)[ENCRYPTED_CONTEXT_KEY] = 'decrypt'
		const { result, siblingData } = callSeal(
			sealMarker({ bidxName: 'ssn_bidx', fieldName: 'ssn', queryable: true }),
			sealed,
			req
		)
		expect(await result).toBe(sealed)
		expect(siblingData.ssn_bidx).toBeNull()
	})

	it('seals a locale=all map per locale under each locale AAD (M3)', async () => {
		const ring = await resolveKeys(undefined, SECRET)
		const out = (await callSeal(
			sealMarker({ fieldName: 'note', localized: true }),
			{ de: 'hallo', en: 'hello' },
			hookReq('all')
		).result) as Record<string, string>
		const en = out.en as string
		const de = out.de as string
		expect(isSealed(en)).toBe(true)
		expect(isSealed(de)).toBe(true)
		expect(en).not.toBe(de)
		expect(unseal(en, ring.dataKeys, ['users.note.en'])).toBe('hello')
		expect(unseal(de, ring.dataKeys, ['users.note.de'])).toBe('hallo')
		// Cross-locale AAD must not authenticate: each locale is bound to its own.
		expect(() => unseal(en, ring.dataKeys, ['users.note.de'])).toThrow()
	})

	it('stashes fresh plaintext keyed by the sealed value it produced (M2 hand-off to validate)', async () => {
		const req = hookReq()
		const out = await callSeal(sealMarker({ fieldName: 'ssn' }), 'secret', req).result
		expect(isSealed(out)).toBe(true)
		// Keyed by the unique sealed value, not the field path (bulk-write safe).
		const stash = (req.context as Record<string, Record<string, unknown>>)
			.__tenxFieldsEncryptedPlaintext
		expect(stash?.[out as string]).toBe('secret')
	})
})

describe('plaintext stash is collision-free under concurrent bulk writes (shared req.context)', () => {
	// Mirrors payload.update({ where, data }): docs.map + Promise.all with ONE req,
	// so every document's field shares req.context. Each doc runs the field's
	// beforeChange hook then its validate (Payload's per-field order). With a path
	// key these collided; keying by the unique sealed value must not.
	const runConcurrent = async (m: EncryptedFieldMarker, values: unknown[]) => {
		const req = hookReq()
		const validatedOwn: boolean[] = []
		await Promise.all(
			values.map(async (plaintext) => {
				const sealed = await callSeal(m, plaintext, req).result
				let seen: unknown
				const validate = makeComposedValidate((v) => {
					seen = v
					return true
				})
				const result = validate(sealed as never, { req } as never)
				// Every doc must validate its OWN plaintext: no bypass, no cross-doc.
				validatedOwn.push(result === true && seen === plaintext)
			})
		)
		return validatedOwn
	}

	it('every single-value document validates its own plaintext (no bypass, no cross-doc)', async () => {
		const outcomes = await runConcurrent(sealMarker({ fieldName: 'ssn' }), [
			'alice',
			'bob',
			'carol',
			'dave',
			'erin',
		])
		expect(outcomes).toHaveLength(5)
		expect(outcomes.every(Boolean)).toBe(true)
	})

	it('every hasMany document validates its own plaintext array', async () => {
		const outcomes = await runConcurrent(sealMarker({ fieldName: 'tags', hasMany: true }), [
			['a1', 'a2'],
			['b1', 'b2'],
			['c1'],
			['d1', 'd2', 'd3'],
		])
		expect(outcomes).toHaveLength(4)
		expect(outcomes.every(Boolean)).toBe(true)
	})
})
