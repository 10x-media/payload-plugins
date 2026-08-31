import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { dualSession } from '../../src/index'

const collections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{ slug: 'customers', auth: true, fields: [] },
]

const registered = (booted: BootedPayload, slug: 'customers' | 'users') => {
	const collection = booted.payload.collections[slug]
	if (!collection) {
		throw new Error(`collection "${slug}" did not register`)
	}
	return collection
}

describeForDb('dualSession loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dualSession({ collections: ['customers'] }),
			collections,
			db,
			configOverrides: { admin: { user: 'users' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('payload boots with the plugin loaded', () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('shadows the built-in auth endpoints on the isolated collection', () => {
		const endpoints = registered(booted, 'customers').config.endpoints || []
		const shadowed = endpoints.slice(0, 6).map((endpoint) => `${endpoint.method} ${endpoint.path}`)

		expect(shadowed).toEqual([
			'post /login',
			'post /logout',
			'post /refresh-token',
			'get /me',
			'post /reset-password',
			'post /first-register',
		])
	})

	it('leaves the admin collection on the shared cookie', () => {
		const strategies = registered(booted, 'users').config.auth.strategies

		expect(strategies.map(({ name }) => name)).not.toContain('users-dual-session')
	})
})
