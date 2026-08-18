import type { CollectionConfig, CollectionSlug, Config } from 'payload'
import { describe, expect, it } from 'vitest'

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

	it('rejects collections that are missing or have no auth', () => {
		expect(() => dualSession({ collections: [slug('ghosts')] })(buildConfig())).toThrow(
			/is not in the config/
		)
		expect(() => dualSession({ collections: [slug('pages')] })(buildConfig())).toThrow(
			/does not have auth enabled/
		)
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
