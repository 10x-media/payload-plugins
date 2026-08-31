import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { providerCreateAccess, providerRowAccess } from './access'

const req = (user: unknown): PayloadRequest => ({ user }) as PayloadRequest

const base = {
	scopeField: 'scope',
	resolveScope: async () => 't1' as string | null,
	platformRead: async () => false,
}

describe('providerRowAccess', () => {
	it('denies anonymous', async () => {
		const access = providerRowAccess({ ...base, scoped: true })
		expect(await access({ req: req(null) })).toBe(false)
	})

	it('unscoped installs allow any authenticated user', async () => {
		const access = providerRowAccess({ ...base, scoped: false })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
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
		const access = providerRowAccess({ ...base, scoped: true, platformRead: async () => true })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('a null resolved scope without platform grant is denied', async () => {
		const access = providerRowAccess({ ...base, scoped: true, resolveScope: async () => null })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})

	it('a throwing scopeResolver fails closed', async () => {
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
})

describe('providerCreateAccess', () => {
	it('denies anonymous', async () => {
		const access = providerCreateAccess({ ...base, scoped: true })
		expect(await access({ req: req(null) })).toBe(false)
	})

	it('unscoped installs allow any authenticated user', async () => {
		const access = providerCreateAccess({ ...base, scoped: false })
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('scoped: authenticated user with a resolved scope may create', async () => {
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
			platformRead: async () => true,
		})
		expect(await access({ req: req({ id: 1 }) })).toBe(true)
	})

	it('scoped: empty-string scope without platform grant is denied', async () => {
		const access = providerCreateAccess({ ...base, scoped: true, resolveScope: async () => '' })
		expect(await access({ req: req({ id: 1 }) })).toBe(false)
	})
})
