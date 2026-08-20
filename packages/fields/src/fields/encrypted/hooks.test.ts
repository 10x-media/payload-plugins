import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolveKeys } from './crypto/keys'
import { isSealed, seal, unseal } from './crypto/wire'
import {
	makeAfterReadHook,
	makeBeforeChangeHook,
	makeRichTextCiphertextHook,
	makeRichTextDecryptHook,
	makeRichTextSealHook,
	makeRichTextValidate,
	makeSetIndicatorHook,
	readAadCandidates,
	sealAad,
} from './hooks'
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
	writeOnly: false,
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
	writeOnly: false,
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

const richMarker = (localized = false): EncryptedFieldMarker =>
	sealMarker({ fieldName: 'body', localized, sourceType: 'richText' })

const STORED = 'body_encrypted'
const EDITOR_STATE = {
	root: { children: [{ children: [{ text: 'secret note', type: 'text' }], type: 'paragraph' }] },
}

const callRichSeal = (args: {
	marker: EncryptedFieldMarker
	req: PayloadRequest
	siblingData?: Record<string, unknown>
	value: unknown
}) => {
	const siblingData = args.siblingData ?? {}
	const hook = makeRichTextSealHook(args.marker, STORED)
	const result = hook({
		collection: { slug: 'users' },
		global: null,
		req: args.req,
		siblingData,
		value: args.value,
	} as unknown as Parameters<typeof hook>[0])
	return { result, siblingData }
}

const callRichDecrypt = (
	m: EncryptedFieldMarker,
	siblingData: Record<string, unknown>,
	req: PayloadRequest
) => {
	const hook = makeRichTextDecryptHook(m, STORED)
	return hook({
		collection: { slug: 'users' },
		context: req.context,
		global: null,
		req,
		siblingData,
		value: undefined,
	} as unknown as Parameters<typeof hook>[0])
}

describe('richText sync hooks (virtual editor field <-> ciphertext sibling)', () => {
	it('seals into the ciphertext sibling and returns the plaintext unchanged', async () => {
		const { result, siblingData } = callRichSeal({
			marker: richMarker(),
			req: hookReq(),
			value: EDITOR_STATE,
		})
		// The virtual value is returned untouched (Payload drops it at the DB write).
		expect(await result).toBe(EDITOR_STATE)
		expect(isSealed(siblingData[STORED])).toBe(true)
	})

	it('round-trips: decrypt reads the ciphertext sibling back to the editor state', async () => {
		const { result, siblingData } = callRichSeal({
			marker: richMarker(),
			req: hookReq(),
			value: EDITOR_STATE,
		})
		await result
		const decrypted = await callRichDecrypt(richMarker(), siblingData, hookReq())
		expect(decrypted).toEqual(EDITOR_STATE)
	})

	it('leaves the existing ciphertext untouched when the virtual value is absent', async () => {
		const { result, siblingData } = callRichSeal({
			marker: richMarker(),
			req: hookReq(),
			siblingData: { [STORED]: 'preexisting-ciphertext' },
			value: undefined,
		})
		expect(await result).toBeUndefined()
		expect(siblingData[STORED]).toBe('preexisting-ciphertext')
	})

	it('clears the ciphertext sibling when the value is null', async () => {
		const { result, siblingData } = callRichSeal({
			marker: richMarker(),
			req: hookReq(),
			siblingData: { [STORED]: 'old' },
			value: null,
		})
		expect(await result).toBeNull()
		expect(siblingData[STORED]).toBeNull()
	})

	it('does not seal under utility context modes (rotate owns the ciphertext then)', async () => {
		const req = hookReq()
		;(req.context as Record<string, unknown>)[ENCRYPTED_CONTEXT_KEY] = 'rotate'
		const { result, siblingData } = callRichSeal({ marker: richMarker(), req, value: EDITOR_STATE })
		expect(await result).toBe(EDITOR_STATE)
		expect(siblingData[STORED]).toBeUndefined()
	})

	it('decrypt passes through under utility context modes without touching the sibling', async () => {
		const req = hookReq()
		;(req.context as Record<string, unknown>)[ENCRYPTED_CONTEXT_KEY] = 'raw'
		const siblingData = { [STORED]: 'raw-ciphertext' }
		expect(await callRichDecrypt(richMarker(), siblingData, req)).toBeUndefined()
	})

	it('decrypt returns the raw ciphertext when the value is not sealed (passthrough policy)', async () => {
		const marker: EncryptedFieldMarker = { ...richMarker(), onDecryptFailure: 'passthrough' }
		const siblingData = { [STORED]: 'not-sealed' }
		expect(await callRichDecrypt(marker, siblingData, hookReq())).toBe('not-sealed')
	})
})

describe('richText ciphertext hook (rotate-only)', () => {
	const callCipher = (value: unknown, req: PayloadRequest) => {
		const hook = makeRichTextCiphertextHook(richMarker())
		return hook({
			collection: { slug: 'users' },
			global: null,
			req,
			siblingData: {},
			value,
		} as unknown as Parameters<typeof hook>[0])
	}

	it('is a no-op in normal mode (the seal hook is the sole producer)', async () => {
		expect(await callCipher('anything', hookReq())).toBeUndefined()
	})

	it('passes a value already on the active key through unchanged under rotate', async () => {
		const ring = await resolveKeys(undefined, SECRET)
		const sealed = seal({
			aad: 'users.body',
			key: ring.dataKeys.get(ring.activeId) as Buffer,
			keyId: ring.activeId,
			plaintext: EDITOR_STATE,
		})
		const req = hookReq()
		;(req.context as Record<string, unknown>)[ENCRYPTED_CONTEXT_KEY] = 'rotate'
		expect(await callCipher(sealed, req)).toBe(sealed)
	})
})

describe('richText validate (delegates to the editor, guards utility flows)', () => {
	const validate = makeRichTextValidate()

	it('skips utility context modes so rotation never trips a required check', () => {
		const options = { req: { context: { [ENCRYPTED_CONTEXT_KEY]: 'rotate' } } }
		expect(validate(undefined, options as never)).toBe(true)
	})

	it('skips an absent value (partial write / utility patch)', () => {
		expect(validate(undefined, { req: { context: {} } } as never)).toBe(true)
	})

	it('delegates to the editor validate with the plaintext value', () => {
		let seen: unknown
		const editor = {
			validate: (value: unknown) => {
				seen = value
				return 'required'
			},
		}
		expect(validate(EDITOR_STATE, { editor, req: { context: {} } } as never)).toBe('required')
		expect(seen).toBe(EDITOR_STATE)
	})

	it('passes when no editor validate is present', () => {
		expect(validate(EDITOR_STATE, { req: { context: {} } } as never)).toBe(true)
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

describe('write-only read behavior', () => {
	it('afterRead passes the sealed value through untouched (never decrypts)', async () => {
		const m = sealMarker({ fieldName: 'apiKey', writeOnly: true })
		const req = hookReq()
		const sealed = await callSeal(m, 'hunter2', req).result
		const hook = makeAfterReadHook(m)
		const result = await hook({
			collection: { slug: 'users' },
			context: {},
			global: null,
			req,
			value: sealed,
		} as unknown as Parameters<typeof hook>[0])
		expect(result).toBe(sealed)
		expect(isSealed(result)).toBe(true)
	})
})

describe('hint sibling maintenance (seal-time, same hook as the ciphertext)', () => {
	const hintMarker = sealMarker({
		fieldName: 'apiKey',
		hint: { prefix: 4, suffix: 4 },
		hintName: 'apiKey_hint',
		writeOnly: true,
	})

	it('writes the hint beside the sealed value', async () => {
		const { result, siblingData } = callSeal(
			hintMarker,
			'sk_demo_a1b2c3d4e5f6a7b8c9d0e1f2a3b49d3f',
			hookReq()
		)
		expect(isSealed(await result)).toBe(true)
		expect(siblingData.apiKey_hint).toBe('sk_d····9d3f')
	})

	it('stores null for a plaintext too short to hint safely', async () => {
		const { result, siblingData } = callSeal(hintMarker, 'short-secret', hookReq())
		expect(isSealed(await result)).toBe(true)
		expect(siblingData.apiKey_hint).toBeNull()
	})

	it('nulls the hint when the value clears', async () => {
		const { result, siblingData } = callSeal(hintMarker, null, hookReq())
		expect(await result).toBeNull()
		expect(siblingData.apiKey_hint).toBeNull()
	})

	it('treats a write-only empty string as a clear (never seals a trap state)', async () => {
		const { result, siblingData } = callSeal(hintMarker, '', hookReq())
		expect(await result).toBeNull()
		expect(siblingData.apiKey_hint).toBeNull()
	})

	it('still seals an empty string for non-write-only fields (unchanged behavior)', async () => {
		const out = await callSeal(sealMarker({ fieldName: 'ssn' }), '', hookReq()).result
		expect(isSealed(out)).toBe(true)
	})

	it('leaves the hint untouched on a sealed passthrough (unchanged value)', async () => {
		const sealed = await callSeal(hintMarker, 'sk_demo_a1b2c3d4e5f6a7b8c9d0e1f2a3b49d3f', hookReq())
			.result
		const { result, siblingData } = callSeal(hintMarker, sealed, hookReq())
		expect(await result).toBe(sealed)
		expect('apiKey_hint' in siblingData).toBe(false)
	})
})

describe('makeSetIndicatorHook (virtual set-indicator sibling)', () => {
	const call = (stored: unknown, context: Record<string, unknown> = {}) => {
		const hook = makeSetIndicatorHook('apiKey')
		return hook({
			context,
			siblingData: { apiKey: stored },
			value: undefined,
		} as unknown as Parameters<typeof hook>[0])
	}

	it('true for a sealed sibling, false for null/undefined', () => {
		expect(call('pfe1.k.a.b.c')).toBe(true)
		expect(call(null)).toBe(false)
		expect(call(undefined)).toBe(false)
	})

	it('hasMany arrays count as set when any item exists', () => {
		expect(call(['pfe1.k.a.b.c'])).toBe(true)
		expect(call([])).toBe(false)
		expect(call([null])).toBe(false)
	})

	it('locale maps count as set when any locale holds a value', () => {
		expect(call({ de: 'pfe1.k.a.b.c', en: null })).toBe(true)
		expect(call({ de: null, en: null })).toBe(false)
	})

	it('locale maps of arrays recurse: empty and null-only arrays read as unset', () => {
		expect(call({ en: [] })).toBe(false)
		expect(call({ en: [null] })).toBe(false)
		expect(call({ de: [], en: ['pfe1.k.a.b.c'] })).toBe(true)
	})

	it('utility contexts pass through untouched (raw reads see no synthesized data)', () => {
		expect(call('pfe1.k.a.b.c', { [ENCRYPTED_CONTEXT_KEY]: 'raw' })).toBeUndefined()
	})
})
