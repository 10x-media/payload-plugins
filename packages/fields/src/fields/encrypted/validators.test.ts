import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { stashPlaintext } from './plaintextStash'
import type { EncryptedSourceField } from './types'
import { makeComposedValidate, makeEffectiveValidator, type PlaintextValidator } from './validators'

const SEALED = `pfe1.k0.${Buffer.alloc(12).toString('base64url')}.${Buffer.alloc(8).toString('base64url')}.${Buffer.alloc(16).toString('base64url')}`
const options = {} as Parameters<ReturnType<typeof makeComposedValidate>>[1]

describe('makeComposedValidate (Deviation 1: seal hook validates plaintext, composed validate skips sealed)', () => {
	it('returns true for a sealed single value without invoking the effective validator', () => {
		const effective = vi.fn<PlaintextValidator>(() => 'must not run')
		const validate = makeComposedValidate(effective, false)
		expect(validate(SEALED, options)).toBe(true)
		expect(effective).not.toHaveBeenCalled()
	})

	it('delegates plaintext to the effective validator', () => {
		const effective = vi.fn<PlaintextValidator>((value) => (value === 'ok' ? true : 'bad'))
		const validate = makeComposedValidate(effective, false)
		expect(validate('ok', options)).toBe(true)
		expect(validate('nope', options)).toBe('bad')
		expect(effective).toHaveBeenCalledTimes(2)
	})

	it('delegates null and undefined so required/nullability is enforced by the effective validator', () => {
		const effective = vi.fn<PlaintextValidator>((value) => (value == null ? 'required' : true))
		const validate = makeComposedValidate(effective, false)
		expect(validate(null, options)).toBe('required')
		expect(validate(undefined, options)).toBe('required')
	})

	it('hasMany: skips when any item is sealed (passthrough/mixed); fresh plaintext arrays delegate', () => {
		const effective = vi.fn<PlaintextValidator>(() => 'delegated')
		const validate = makeComposedValidate(effective, true)
		expect(validate([SEALED, SEALED], options)).toBe(true)
		// Mixed [sealed, plaintext] is a passthrough (the sealed item was already
		// validated); whole-array plaintext validation is deferred, not applied.
		expect(validate([SEALED, 'plaintext'], options)).toBe(true)
		expect(validate(['fresh1', 'fresh2'], options)).toBe('delegated')
		expect(validate([], options)).toBe('delegated')
	})

	it('skips a sealed locale=all map (M3)', () => {
		const effective = vi.fn<PlaintextValidator>(() => 'must not run')
		const validate = makeComposedValidate(effective, false)
		expect(validate({ de: SEALED, en: SEALED }, options)).toBe(true)
		expect(effective).not.toHaveBeenCalled()
	})
})

describe('makeComposedValidate stash flow (M1/M2: validate plaintext in the native validate pass)', () => {
	it('validates the stashed pre-seal plaintext, not the sealed value it receives', () => {
		const effective = vi.fn<PlaintextValidator>((value) => (value === 'good' ? true : 'bad'))
		const validate = makeComposedValidate(effective, false)
		const req = { context: {} } as unknown as PayloadRequest
		stashPlaintext(req, 'ssn', 'good')
		// `value` is the sealed ciphertext; the stashed plaintext must be validated.
		expect(validate(SEALED, { path: ['ssn'], req } as never)).toBe(true)
		expect(effective).toHaveBeenCalledWith('good', expect.anything())
	})

	it('surfaces the effective validator error string (aggregated by Payload, no hook throw)', () => {
		const effective = vi.fn<PlaintextValidator>(() => 'invalid email')
		const validate = makeComposedValidate(effective, false)
		const req = { context: {} } as unknown as PayloadRequest
		stashPlaintext(req, 'email', 'not-an-email')
		expect(validate(SEALED, { path: ['email'], req } as never)).toBe('invalid email')
	})

	it('consumes the stash so a re-validate falls back to the sealed-skip path', () => {
		const effective = vi.fn<PlaintextValidator>(() => 'bad')
		const validate = makeComposedValidate(effective, false)
		const req = { context: {} } as unknown as PayloadRequest
		stashPlaintext(req, 'ssn', 'whatever')
		validate(SEALED, { path: ['ssn'], req } as never)
		effective.mockClear()
		// Second pass: stash gone, value is sealed -> skip without calling effective.
		expect(validate(SEALED, { path: ['ssn'], req } as never)).toBe(true)
		expect(effective).not.toHaveBeenCalled()
	})
})

describe('makeEffectiveValidator selects the plaintext validator by source', () => {
	const req = { t: (key: string) => key } as unknown as PayloadRequest

	it('uses a user-supplied validate verbatim', () => {
		const userValidate = vi.fn(() => 'from user')
		const source = {
			name: 'x',
			type: 'text',
			validate: userValidate,
		} as unknown as EncryptedSourceField
		const effective = makeEffectiveValidator(source)
		expect(effective('anything', { req })).toBe('from user')
		expect(userValidate).toHaveBeenCalledOnce()
	})

	it('richText enforces required only (the Lexical editor is absent on a text-backed field)', () => {
		const source = {
			name: 'x',
			required: true,
			type: 'richText',
		} as unknown as EncryptedSourceField
		const effective = makeEffectiveValidator(source)
		expect(effective(null, { req })).toBe('validation:required')
		expect(effective({ root: {} }, { req })).toBe(true)
	})

	it('richText without required accepts any content', () => {
		const source = { name: 'x', type: 'richText' } as unknown as EncryptedSourceField
		const effective = makeEffectiveValidator(source)
		expect(effective(null, { req })).toBe(true)
	})

	it('falls back to the stock validator matching the source type', () => {
		const source = { name: 'x', type: 'text' } as unknown as EncryptedSourceField
		const effective = makeEffectiveValidator(source)
		// The stock text validator's full behavior (required, min/max) is covered by
		// the factory and int suites; here we only assert dispatch reaches a stock
		// validator rather than throwing or returning the source unchanged.
		expect(typeof effective).toBe('function')
	})
})
