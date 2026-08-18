import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { dualSession } from '../../src/index'

const slug = (value: string) => value as CollectionSlug

const collections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{ slug: 'customers', auth: { useAPIKey: true }, fields: [] },
	{
		slug: 'machines',
		auth: { disableLocalStrategy: true },
		fields: [{ name: 'label', type: 'text' }],
	},
]

/**
 * The plugin rests on four details of Payload's internals, none of which is a documented
 * contract. Each is cheap to assert and expensive to discover after a Payload upgrade has
 * already shipped, so they are asserted here directly rather than inferred from behaviour.
 */
describeForDb('the core behaviour dualSession depends on', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dualSession({ collections: [slug('customers'), slug('machines')] }),
			collections,
			db,
			configOverrides: { admin: { user: 'users' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('appends its built-in auth endpoints after the ones declared on the collection', () => {
		const endpoints = booted.payload.collections.customers?.config.endpoints || []
		const logins = endpoints
			.map((endpoint, index) => ({ index, path: `${endpoint.method} ${endpoint.path}` }))
			.filter(({ path }) => path === 'post /login')

		// Two `post /login` entries now exist: ours and core's. `handleEndpoints` takes the
		// first match, so ours has to be the earlier one for the shadow to work at all.
		expect(logins).toHaveLength(2)
		expect(logins[0]?.index).toBe(0)
	})

	it('runs a collection’s own auth strategies before the shared-cookie one', () => {
		const names = booted.payload.authStrategies.map(({ name }) => name)

		expect(names).toContain('customers-dual-session')
		expect(names.at(-1)).toBe('local-jwt')
		expect(names.indexOf('customers-dual-session')).toBeLessThan(names.indexOf('local-jwt'))
	})

	it('places a collection’s api-key strategy after that collection’s own strategies', () => {
		const names = booted.payload.authStrategies.map(({ name }) => name)

		// This is why the isolated cookie currently outranks an `Authorization` API key,
		// inverting core's own `jwtOrder`. Documented as a known divergence.
		expect(names.indexOf('customers-dual-session')).toBeLessThan(names.indexOf('customers-api-key'))
	})

	it('registers the auth endpoints even when local login is disabled', () => {
		const endpoints = booted.payload.collections.machines?.config.endpoints || []
		const paths = endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)

		// Core does not skip `/login` for `disableLocalStrategy`; the operation refuses
		// instead. So shadowing unconditionally matches core rather than adding routes.
		expect(paths.filter((path) => path === 'post /login')).toHaveLength(2)
	})

	it('reads the `Authorization` header before the cookie', () => {
		// The order the plugin deliberately inverts for isolated collections.
		expect(booted.payload.config.auth.jwtOrder).toEqual(['JWT', 'Bearer', 'cookie'])
	})
})
