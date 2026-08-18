import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { AuthStrategyFunctionArgs, CollectionConfig, Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { dualSession } from '../../src/index'

const ADMIN = { email: 'admin@10xmedia.de', password: 'password' }
const CUSTOMER = { email: 'customer@10xmedia.de', password: 'password' }

const collections: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{ slug: 'customers', auth: true, fields: [] },
]

const seed = async (payload: Payload) => {
	await payload.create({ collection: 'users', data: ADMIN })
	await payload.create({ collection: 'customers', data: CUSTOMER })
}

const cookieHeaders = (cookies: Record<string, string>) =>
	new Headers({
		Cookie: Object.entries(cookies)
			.map(([name, value]) => `${name}=${value}`)
			.join('; '),
	})

describeForDb('dualSession sessions', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let adminToken: string
	let customerToken: string

	const authenticate = (headers: Headers) => {
		const strategy = booted.payload.collections.customers?.config.auth.strategies.find(
			({ name }) => name === 'customers-dual-session'
		)
		if (!strategy) {
			throw new Error('the isolated strategy was not registered')
		}
		return strategy.authenticate({
			headers,
			payload: booted.payload,
		} as AuthStrategyFunctionArgs)
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dualSession({ collections: ['customers'] }),
			collections,
			db,
			seed,
			configOverrides: { admin: { user: 'users' } },
		})

		const admin = await booted.payload.login({ collection: 'users', data: ADMIN })
		const customer = await booted.payload.login({ collection: 'customers', data: CUSTOMER })

		adminToken = admin.token ?? ''
		customerToken = customer.token ?? ''
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('authenticates a customer from its own cookie', async () => {
		const result = await authenticate(cookieHeaders({ 'payload-customers-token': customerToken }))

		expect(result.user).toMatchObject({ collection: 'customers', email: CUSTOMER.email })
	})

	it('ignores the shared admin cookie entirely', async () => {
		const result = await authenticate(cookieHeaders({ 'payload-token': adminToken }))

		expect(result.user).toBeNull()
	})

	it('stands down for an admin-scoped request, keeping the admin panel reachable', async () => {
		const headers = cookieHeaders({
			'payload-token': adminToken,
			'payload-customers-token': customerToken,
		})
		headers.set('x-payload-auth-scope', 'admin')

		expect((await authenticate(headers)).user).toBeNull()
	})

	it('authenticates a frontend-scoped request even while an admin session is live', async () => {
		const headers = cookieHeaders({
			'payload-token': adminToken,
			'payload-customers-token': customerToken,
		})
		headers.set('x-payload-auth-scope', 'frontend')

		expect((await authenticate(headers)).user).toMatchObject({ email: CUSTOMER.email })
	})

	it('rejects the customer token once its session is revoked', async () => {
		await booted.payload.update({
			collection: 'customers',
			where: { email: { equals: CUSTOMER.email } },
			data: { sessions: [] },
		})

		const result = await authenticate(cookieHeaders({ 'payload-customers-token': customerToken }))

		expect(result.user).toBeNull()
	})
})
