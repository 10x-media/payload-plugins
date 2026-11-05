import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	createStrictTimezoneResolver,
	createTimezoneResolver,
	TimezoneResolutionError,
} from './reportingTimezone'

const reqWith = (warn = vi.fn()): PayloadRequest =>
	({ payload: { logger: { warn } } }) as unknown as PayloadRequest

const resolveScope = async () => 'tenant-a'

describe('createTimezoneResolver', () => {
	it('reads UTC when unset and the validated string when set', async () => {
		expect(await createTimezoneResolver({ option: undefined, resolveScope })(reqWith())).toBe('UTC')
		const fixed = createTimezoneResolver({ option: 'Europe/Berlin', resolveScope })
		expect(await fixed(reqWith())).toBe('Europe/Berlin')
	})

	it("hands a resolver the request's scope, or the one the caller already resolved", async () => {
		const option = vi.fn(async () => 'Asia/Tokyo')
		const resolve = createTimezoneResolver({ option, resolveScope })
		const req = reqWith()
		expect(await resolve(req)).toBe('Asia/Tokyo')
		expect(option).toHaveBeenLastCalledWith({ req, scope: 'tenant-a' })
		await resolve(req, null)
		expect(option).toHaveBeenLastCalledWith({ req, scope: null })
	})

	it('reads UTC for a null answer without a word', async () => {
		const warn = vi.fn()
		const resolve = createTimezoneResolver({ option: () => null, resolveScope })
		expect(await resolve(reqWith(warn))).toBe('UTC')
		expect(warn).not.toHaveBeenCalled()
	})

	it('reads an invalid answer in UTC and warns once per distinct value', async () => {
		const warn = vi.fn()
		const answers = ['Mars/Olympus', 'Mars/Olympus', 'Venus/Maxwell', 'Mars/Olympus']
		const resolve = createTimezoneResolver({
			option: () => answers.shift() ?? null,
			resolveScope,
		})
		for (let i = 0; i < 4; i++) {
			expect(await resolve(reqWith(warn))).toBe('UTC')
		}
		expect(warn).toHaveBeenCalledTimes(2)
		expect(warn.mock.calls[0]?.[0]).toContain('"Mars/Olympus"')
		expect(warn.mock.calls[1]?.[0]).toContain('"Venus/Maxwell"')
	})

	// A resolver may answer from request data, so the warned set cannot grow without bound.
	it('stops warning after a hundred distinct invalid values', async () => {
		const warn = vi.fn()
		let n = 0
		const resolve = createTimezoneResolver({ option: () => `Bad/Zone${n++}`, resolveScope })
		for (let i = 0; i < 150; i++) {
			await resolve(reqWith(warn))
		}
		expect(warn).toHaveBeenCalledTimes(100)
	})

	it('reads UTC and warns when the resolver throws', async () => {
		const warn = vi.fn()
		const resolve = createTimezoneResolver({
			option: () => {
				throw new Error('tz service down')
			},
			resolveScope,
		})
		expect(await resolve(reqWith(warn))).toBe('UTC')
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('tz service down'))
	})

	it('reads UTC and warns when the scope it asks for cannot be resolved', async () => {
		const warn = vi.fn()
		const resolve = createTimezoneResolver({
			option: async () => 'Asia/Tokyo',
			resolveScope: async () => {
				throw new Error('tenant lookup down')
			},
		})
		expect(await resolve(reqWith(warn))).toBe('UTC')
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('tenant lookup down'))
	})
})

describe('createStrictTimezoneResolver', () => {
	it('answers the zone the option names, and UTC when unset or answered null', async () => {
		expect(await createStrictTimezoneResolver({ option: undefined, resolveScope })(reqWith())).toBe(
			'UTC'
		)
		const fixed = createStrictTimezoneResolver({ option: 'Europe/Berlin', resolveScope })
		expect(await fixed(reqWith())).toBe('Europe/Berlin')
		const none = createStrictTimezoneResolver({ option: () => null, resolveScope })
		expect(await none(reqWith(), 'tenant-a')).toBe('UTC')
	})

	it("hands a resolver the caller's scope, null included", async () => {
		const option = vi.fn(async () => 'Asia/Tokyo')
		const resolve = createStrictTimezoneResolver({ option, resolveScope })
		const req = reqWith()
		expect(await resolve(req, null)).toBe('Asia/Tokyo')
		expect(option).toHaveBeenLastCalledWith({ req, scope: null })
	})

	// A day the engine counted in a zone must never be counted again in UTC because one call failed.
	it('throws rather than reading in UTC when the resolver throws or answers no zone', async () => {
		const warn = vi.fn()
		const throwing = createStrictTimezoneResolver({
			option: () => {
				throw new Error('tz service down')
			},
			resolveScope,
		})
		const failure = await throwing(reqWith(warn), 'tenant-a').catch((err: unknown) => err)
		expect(failure).toBeInstanceOf(TimezoneResolutionError)
		expect(String(failure)).toContain('tz service down')

		const invalid = createStrictTimezoneResolver({ option: () => 'Mars/Olympus', resolveScope })
		const refused = await invalid(reqWith(warn), 'tenant-a').catch((err: unknown) => err)
		expect(refused).toBeInstanceOf(TimezoneResolutionError)
		expect(refused).toMatchObject({ answer: 'Mars/Olympus' })
		expect(warn).not.toHaveBeenCalled()
	})

	it('throws when the scope it would ask for cannot be resolved', async () => {
		const resolve = createStrictTimezoneResolver({
			option: async () => 'Asia/Tokyo',
			resolveScope: async () => {
				throw new Error('tenant lookup down')
			},
		})
		await expect(resolve(reqWith())).rejects.toThrow(/tenant lookup down/)
	})
})
