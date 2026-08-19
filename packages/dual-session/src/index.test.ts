import type { CollectionConfig, CollectionSlug, Config, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { dualSession } from './index'
import { keys } from './translations'

/** The fixtures use slugs that do not exist in this package's generated types. */
const slug = (value: string) => value as CollectionSlug

const buildConfig = (overrides: Record<string, unknown> = {}): Config =>
	({
		collections: [
			{ slug: 'users', auth: true, fields: [] },
			{ slug: 'customers', auth: true, fields: [] },
			{ slug: 'pages', fields: [] },
		],
		...overrides,
	}) as unknown as Config

const getCollection = (config: Config, collectionSlug: string) =>
	(config.collections ?? []).find(
		(collection) => collection.slug === collectionSlug
	) as CollectionConfig

const getEndpoints = (collection: CollectionConfig) =>
	collection.endpoints as { method: string; path: string }[]

describe('dualSession factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof dualSession({ collections: [slug('customers')] })).toBe('function')
	})

	it('gives each isolated collection its own cookie-scoped auth endpoints', () => {
		const config = dualSession({ collections: [slug('customers')] })(buildConfig()) as Config
		const endpoints = getEndpoints(getCollection(config, 'customers'))

		// Payload appends its built-ins after these and matches the first hit, so the
		// replacements must come first to shadow them.
		expect(endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
			'post /login',
			'post /logout',
			'post /refresh-token',
			'get /me',
			'post /reset-password',
			'post /first-register',
		])
	})

	it('registers a cookie strategy on the isolated collection', () => {
		const config = dualSession({ collections: [slug('customers')] })(buildConfig()) as Config
		const auth = getCollection(config, 'customers').auth as { strategies: { name: string }[] }

		expect(auth.strategies.map(({ name }) => name)).toEqual(['customers-dual-session'])
	})

	it('preserves endpoints and strategies already declared on the collection', () => {
		const existingEndpoint = {
			handler: async () => Response.json({}),
			method: 'get',
			path: '/ping',
		}
		const existingStrategy = { authenticate: async () => ({ user: null }), name: 'sso' }

		const config = dualSession({ collections: [slug('customers')] })(
			buildConfig({
				collections: [
					{ slug: 'users', auth: true, fields: [] },
					{
						slug: 'customers',
						auth: { strategies: [existingStrategy] },
						endpoints: [existingEndpoint],
						fields: [],
					},
				],
			})
		) as Config

		const customers = getCollection(config, 'customers')
		const auth = customers.auth as { strategies: { name: string }[] }

		expect(getEndpoints(customers)).toHaveLength(7)
		expect(getEndpoints(customers).at(-1)).toBe(existingEndpoint)
		expect(auth.strategies.map(({ name }) => name)).toEqual(['sso', 'customers-dual-session'])
	})

	it('leaves untouched collections alone', () => {
		const incoming = buildConfig()
		const config = dualSession({ collections: [slug('customers')] })(incoming) as Config

		expect(getCollection(config, 'users')).toBe(getCollection(incoming, 'users'))
		expect(getCollection(config, 'pages')).toBe(getCollection(incoming, 'pages'))
	})

	it('respects `endpoints: false`', () => {
		const config = dualSession({ collections: [slug('customers')] })(
			buildConfig({
				collections: [
					{ slug: 'users', auth: true, fields: [] },
					{ slug: 'customers', auth: true, endpoints: false, fields: [] },
				],
			})
		) as Config

		expect(getCollection(config, 'customers').endpoints).toBe(false)
	})

	it('refuses to isolate the admin collection, which owns the shared cookie', () => {
		expect(() => dualSession({ collections: [slug('users')] })(buildConfig())).toThrow(
			/backs the admin panel/
		)
	})

	it('shadows the admin collection too once an `isolate` predicate splits it', () => {
		const config = dualSession({
			collections: [{ slug: slug('users'), isolate: () => true }],
		})(buildConfig()) as Config
		const users = getCollection(config, 'users')
		const auth = users.auth as { strategies: { name: string }[] }

		// Role-split: the endpoints and the strategy are the same ones any isolated
		// collection gets. What changes is that each of them asks the predicate first.
		expect(getEndpoints(users)).toHaveLength(6)
		expect(auth.strategies.map(({ name }) => name)).toEqual(['users-dual-session'])
	})

	it('boots on past a collection it cannot isolate, leaving the config intact', () => {
		// A collection contributed by a later plugin is genuinely absent at this point, so
		// refusing to boot would punish a load-order problem the user can still fix.
		const config = dualSession({ collections: [slug('ghosts')] })(buildConfig()) as Config

		expect(getCollection(config, 'users')).toBeDefined()
		expect(getCollection(config, 'customers').endpoints).toBeUndefined()
	})

	it('reports config-time problems through the logger once Payload has booted', async () => {
		const config = dualSession({ collections: [slug('ghosts')] })(buildConfig()) as Config
		const warn = vi.fn()

		// `payload.logger` does not exist while the config is built, so the warning has to
		// wait for onInit rather than go to the console.
		await config.onInit?.({ logger: { warn } } as unknown as Payload)

		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/is not in the config/))
	})

	it('keeps the project’s own onInit', async () => {
		const priorOnInit = vi.fn()
		const config = dualSession({ collections: [slug('ghosts')] })(
			buildConfig({ onInit: priorOnInit })
		) as Config

		await config.onInit?.({ logger: { warn: vi.fn() } } as unknown as Payload)

		expect(priorOnInit).toHaveBeenCalledOnce()
	})

	it('leaves onInit alone when there is nothing to report', () => {
		const incoming = buildConfig()
		const config = dualSession({ collections: [slug('customers')] })(incoming) as Config

		expect(config.onInit).toBe(incoming.onInit)
	})

	it('finds the admin collection the way sanitizeConfig does when `admin.user` is unset', () => {
		// Core defaults `admin.user` to the first collection declaring auth, so guessing
		// `users` would let a project isolate the very collection backing its admin panel.
		expect(() =>
			dualSession({ collections: [slug('staff')] })(
				buildConfig({
					collections: [
						{ slug: 'staff', auth: true, fields: [] },
						{ slug: 'customers', auth: true, fields: [] },
					],
				})
			)
		).toThrow(/backs the admin panel/)
	})

	it('returns the incoming config when disabled', () => {
		const incoming = buildConfig()
		expect(dualSession({ collections: [slug('customers')], disabled: true })(incoming)).toBe(
			incoming
		)
	})

	it('applies the translations option', () => {
		const out = dualSession({
			collections: [slug('customers')],
			translations: { de: { [keys.pluginName]: 'Doppelte Sitzung' } },
		})(buildConfig()) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>

		expect(i18n.de?.dualSession?.pluginName).toBe('Doppelte Sitzung')
		expect(i18n.en?.dualSession?.pluginName).toBe('Dual Session')
	})
})
