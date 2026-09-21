import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	FallbackLocaleError,
	type FormFallbackLocale,
	findFormAtLocale,
	missingFormOnReadError,
	stashFallbackLocale,
} from './findFormAtLocale'

const localization = {
	defaultLocale: 'en',
	localeCodes: ['en', 'de', 'uk'],
	locales: [{ code: 'en' }, { code: 'de' }, { code: 'uk' }],
	fallback: true,
}

const makePayload = (resolver?: FormFallbackLocale, fallback = true) => {
	const findByID = vi.fn().mockResolvedValue({ id: 'f1', tenant: 't1' })
	const payload = {
		config: {
			localization: { ...localization, fallback },
			custom: resolver ? stashFallbackLocale(undefined, resolver) : {},
		},
		findByID,
	} as unknown as Payload
	return { payload, findByID }
}

describe('findFormAtLocale', () => {
	it('reads once, like any Payload read, without a resolver', async () => {
		const { payload, findByID } = makePayload()
		await findFormAtLocale({ payload, id: 'f1', locale: 'de' })
		expect(findByID).toHaveBeenCalledTimes(1)
		expect(findByID.mock.calls[0]?.[0]).not.toHaveProperty('fallbackLocale')
	})

	it('skips the second read when the resolver keeps the fallback already applied', async () => {
		for (const chosen of [undefined, 'de', 'en']) {
			const { payload, findByID } = makePayload(() => chosen)
			await findFormAtLocale({ payload, id: 'f1', locale: 'de' })
			expect(findByID).toHaveBeenCalledTimes(1)
		}
	})

	it('reads again with the fallback the resolver chooses, given the form it read', async () => {
		const resolver = vi.fn(() => 'uk')
		const { payload, findByID } = makePayload(resolver)
		await findFormAtLocale({ payload, id: 'f1', locale: 'de' })
		expect(resolver).toHaveBeenCalledWith(
			expect.objectContaining({ form: { id: 'f1', tenant: 't1' }, locale: 'de' })
		)
		expect(findByID).toHaveBeenCalledTimes(2)
		expect(findByID.mock.calls[1]?.[0]).toMatchObject({ locale: 'de', fallbackLocale: 'uk' })
	})

	it('forces a fallback the config turned off', async () => {
		const { payload, findByID } = makePayload(() => 'en', false)
		await findFormAtLocale({ payload, id: 'f1', locale: 'de' })
		expect(findByID.mock.calls[1]?.[0]).toMatchObject({ fallbackLocale: 'en' })
	})

	it('surfaces a throwing resolver as a FallbackLocaleError and restores the req', async () => {
		const { payload } = makePayload(() => {
			throw new Error('tenant lookup down')
		})
		const req = { locale: 'en', fallbackLocale: false } as unknown as PayloadRequest
		const read = findFormAtLocale({ payload, id: 'f1', locale: 'de', req })
		await expect(read).rejects.toBeInstanceOf(FallbackLocaleError)
		await expect(read).rejects.toThrow('tenant lookup down')
		expect(req.locale).toBe('en')
		expect(req.fallbackLocale).toBe(false)
	})
})

describe('missingFormOnReadError', () => {
	it('reads a failed form load as missing but lets a resolver failure through', () => {
		expect(missingFormOnReadError(new Error('Not Found'))).toBeNull()
		const error = new FallbackLocaleError(new Error('down'))
		expect(() => missingFormOnReadError(error)).toThrow(error)
	})
})
