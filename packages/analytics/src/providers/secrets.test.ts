import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	maskSecret,
	PROVIDER_SECRET_MASK,
	PROVIDER_SECRET_REVEAL_CONTEXT,
	preserveMaskedSecret,
} from './secrets'

type HookArgs = Parameters<typeof maskSecret>[0]

const reqWithContext = (context: Record<string, unknown>): PayloadRequest =>
	({ context }) as unknown as PayloadRequest

describe('maskSecret', () => {
	it('masks a stored value on a normal read', () => {
		const out = maskSecret({ value: 'raw-key', req: reqWithContext({}) } as unknown as HookArgs)
		expect(out).toBe(PROVIDER_SECRET_MASK)
	})

	it('reveals the raw value when the adapter-factory context flag is set', () => {
		const req = reqWithContext({ [PROVIDER_SECRET_REVEAL_CONTEXT]: true })
		expect(maskSecret({ value: 'raw-key', req } as unknown as HookArgs)).toBe('raw-key')
	})

	it('passes empty values through unmasked', () => {
		const req = reqWithContext({})
		expect(maskSecret({ value: undefined, req } as unknown as HookArgs)).toBeUndefined()
		expect(maskSecret({ value: null, req } as unknown as HookArgs)).toBeNull()
		expect(maskSecret({ value: '', req } as unknown as HookArgs)).toBe('')
	})
})

describe('preserveMaskedSecret', () => {
	it('restores the raw stored value when the masked placeholder round-trips', () => {
		const out = preserveMaskedSecret({
			value: PROVIDER_SECRET_MASK,
			field: { name: 'apiKey' },
			siblingDocWithLocales: { apiKey: 'stored-key' },
		} as unknown as HookArgs)
		expect(out).toBe('stored-key')
	})

	it('accepts a genuinely new value', () => {
		const out = preserveMaskedSecret({
			value: 'rotated-key',
			field: { name: 'apiKey' },
			siblingDocWithLocales: { apiKey: 'stored-key' },
		} as unknown as HookArgs)
		expect(out).toBe('rotated-key')
	})

	it('allows clearing the secret with an empty value', () => {
		const out = preserveMaskedSecret({
			value: '',
			field: { name: 'apiKey' },
			siblingDocWithLocales: { apiKey: 'stored' },
		} as unknown as HookArgs)
		expect(out).toBe('')
	})

	it('keeps the placeholder when no stored value exists to restore', () => {
		const out = preserveMaskedSecret({
			value: PROVIDER_SECRET_MASK,
			field: { name: 'apiKey' },
			siblingDocWithLocales: {},
		} as unknown as HookArgs)
		expect(out).toBe(PROVIDER_SECRET_MASK)
	})
})
