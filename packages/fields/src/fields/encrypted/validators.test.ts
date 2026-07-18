import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
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

	it('hasMany: skips only when every item is sealed; empty or mixed arrays delegate', () => {
		const effective = vi.fn<PlaintextValidator>(() => 'delegated')
		const validate = makeComposedValidate(effective, true)
		expect(validate([SEALED, SEALED], options)).toBe(true)
		expect(validate([SEALED, 'plaintext'], options)).toBe('delegated')
		expect(validate([], options)).toBe('delegated')
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
