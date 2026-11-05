import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { providerCreateAccess, providerRowAccess } from './access'

/** A request on an install whose admin panel signs in through `users`. */
const req = (user: Record<string, unknown> | null): PayloadRequest =>
	({
		user: user === null ? null : { collection: 'users', ...user },
		payload: { config: { admin: { user: 'users' } } },
	}) as unknown as PayloadRequest

const customer = (): PayloadRequest => req({ id: 9, collection: 'customers' })

const base = {
	scopeField: 'scope',
	resolveScope: async () => 't1' as string | null,
	member: () => true,
	crossScope: async () => false,
}

describe('providerRowAccess', () => {
	it('denies anonymous', async () => {
		const access = providerRowAccess({ ...base, scoped: true })
		expect(await access({ req: req(null) })).toBe(false)
	})

	it('unscoped installs allow any user of the admin collection', async () => {
		const access = providerRowAccess({ ...base, scoped: false })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('denies a user of a second auth collection, whatever the install grants', async () => {
		for (const scoped of [false, true]) {
			const access = providerRowAccess({ ...base, scoped, crossScope: async () => true })
			expect(await access({ req: customer() })).toBe(false)
		}
	})

	it('scoped installs constrain to the resolved scope via a where clause', async () => {
		const access = providerRowAccess({ ...base, scoped: true })
		expect(await access({ req: req({ id: 1 }) })).toEqual({ scope: { equals: 't1' } })
	})

	it('uses the configured scopeField in the where clause', async () => {
		const access = providerRowAccess({ ...base, scoped: true, scopeField: 'tenant' })
		expect(await access({ req: req({ id: 1 }) })).toEqual({ tenant: { equals: 't1' } })
	})

	it('platform users are unconstrained', async () => {
		const access = providerRowAccess({ ...base, scoped: true, crossScope: async () => true })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('a null resolved scope without platform grant is denied', async () => {
		const access = providerRowAccess({ ...base, scoped: true, resolveScope: async () => null })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('a throwing scope resolver fails closed', async () => {
		const access = providerRowAccess({
			...base,
			scoped: true,
			resolveScope: async () => {
				throw new Error('boom')
			},
		})
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('an empty-string resolved scope without platform grant is denied', async () => {
		const access = providerRowAccess({ ...base, scoped: true, resolveScope: async () => '' })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	// The scope a request resolves is only the tenant it selected: a selector pointed at a
	// tenant the user does not belong to lists nothing there.
	it('denies a resolved scope the user does not belong to', async () => {
		const access = providerRowAccess({ ...base, scoped: true, member: () => false })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('denies every scope when no membership check was configured', async () => {
		const access = providerRowAccess({ ...base, scoped: true, member: undefined })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('asks membership about the resolved scope, once per request', async () => {
		const asked: string[] = []
		const access = providerRowAccess({
			...base,
			scoped: true,
			member: ({ scope }) => {
				asked.push(scope)
				return true
			},
		})
		const request = req({ id: 1 })
		await access({ req: request })
		await access({ req: request })
		expect(asked).toEqual(['t1'])
	})

	it('lets platform users manage a scope they do not belong to', async () => {
		const access = providerRowAccess({
			...base,
			scoped: true,
			member: () => false,
			crossScope: async () => true,
		})
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})
})

describe('providerCreateAccess', () => {
	it('denies anonymous', async () => {
		const access = providerCreateAccess({ ...base, scoped: true })
		expect(await access({ req: req(null) })).toBe(false)
	})

	it('unscoped installs allow any user of the admin collection', async () => {
		const access = providerCreateAccess({ ...base, scoped: false })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('denies a user of a second auth collection, whatever the install grants', async () => {
		for (const scoped of [false, true]) {
			const access = providerCreateAccess({ ...base, scoped, crossScope: async () => true })
			expect(await access({ req: customer() })).toBe(false)
		}
	})

	it('scoped: a user of the admin collection with a resolved scope may create', async () => {
		const access = providerCreateAccess({ ...base, scoped: true })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('scoped: null scope without platform grant is denied', async () => {
		const access = providerCreateAccess({ ...base, scoped: true, resolveScope: async () => null })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('scoped: null scope with platform grant may create (install-wide provider)', async () => {
		const access = providerCreateAccess({
			...base,
			scoped: true,
			resolveScope: async () => null,
			crossScope: async () => true,
		})
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('scoped: empty-string scope without platform grant is denied', async () => {
		const access = providerCreateAccess({ ...base, scoped: true, resolveScope: async () => '' })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('scoped: a resolved scope the user does not belong to is denied', async () => {
		const access = providerCreateAccess({ ...base, scoped: true, member: () => false })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})
})
