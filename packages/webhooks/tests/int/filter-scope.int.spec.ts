import { createServer, type Server } from 'node:http'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'
import type { SubscriptionFilter } from '../../src/options'
import { LOCAL_SINK } from './localSink'

const tenanted = (slug: string): CollectionConfig => ({
	slug,
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text' },
	],
})

type FilterArgs = Parameters<SubscriptionFilter>[0]

describe('filter and scope', () => {
	let booted: BootedPayload
	let sink: Server
	let sinkUrl: string
	let hits: string[] = []
	let seen: FilterArgs[] = []

	const subscribe = (tenant: string | undefined, events: string[]) =>
		booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: tenant ?? 'none',
				url: `${sinkUrl}/${tenant ?? 'none'}`,
				enabled: true,
				events,
				tenant,
				headers: [{ key: 'Authorization', value: 'Bearer t0ken' }],
			},
			overrideAccess: true,
		})

	const deliveries = async () =>
		(
			await booted.payload.find({
				collection: 'webhook-deliveries',
				overrideAccess: true,
				limit: 100,
			})
		).docs

	beforeAll(async () => {
		sink = createServer((req, res) => {
			hits.push(req.url ?? '')
			res.writeHead(200)
			res.end('ok')
		})
		await new Promise<void>((r) => sink.listen(0, r))
		const addr = sink.address()
		if (addr === null || typeof addr === 'string') {
			throw new Error('no port')
		}
		sinkUrl = `http://127.0.0.1:${addr.port}`
		booted = await bootPayload({
			plugin: webhooks({
				collections: {
					posts: {
						filter: async (args) => {
							seen.push(args)
							await Promise.resolve()
							return (
								args.subscription.source === 'code' ||
								args.subscription.record.tenant === args.doc.tenant
							)
						},
					},
					notes: {
						scope: ({ doc }) => ({ tenant: { equals: doc.tenant } }),
						filter: (args) => {
							seen.push(args)
							return true
						},
					},
					broken: {
						filter: () => {
							throw new Error('filter blew up')
						},
						scope: () => {
							throw new Error('scope blew up')
						},
					},
				},
				subscriptions: [
					{ id: 'ops', url: 'http://127.0.0.1:1/ops', events: ['posts.created'], enabled: true },
				],
				delivery: { mode: 'inline', retries: 0, ...LOCAL_SINK },
				subscriptionsCollection: {
					overrides: {
						fields: ({ defaultFields }) => [
							...defaultFields,
							{ name: 'tenant', type: 'text', index: true },
						],
					},
				},
			}),
			db: 'mongo',
			collections: [tenanted('posts'), tenanted('notes'), tenanted('broken')],
		})
	})

	afterAll(async () => {
		await booted.stop()
		await new Promise<void>((r) => sink.close(() => r()))
	})

	afterEach(async () => {
		hits = []
		seen = []
		await booted.payload.delete({
			collection: 'webhook-subscriptions',
			where: {},
			overrideAccess: true,
		})
		await booted.payload.delete({
			collection: 'webhook-deliveries',
			where: {},
			overrideAccess: true,
		})
	})

	it('delivers where the filter accepts, and leaves no row where it rejects', async () => {
		const a = await subscribe('a', ['posts.created'])
		await subscribe('b', ['posts.created'])
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		expect(hits).toEqual(['/a'])
		const rows = (await deliveries()).filter((d) => d.subscriptionSource === 'collection')
		expect(rows).toHaveLength(1)
		expect(rows[0]?.subscriptionId).toBe(String(a.id))
	})

	it('hands the filter the stored subscription, application fields included, and no key material', async () => {
		await subscribe('a', ['posts.created'])
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		const call = seen.find((s) => s.subscription.source === 'collection')
		expect(call?.subscription.record.tenant).toBe('a')
		expect(call?.subscription.record.name).toBe('a')
		expect(call?.subscription.record).not.toHaveProperty('secret')
		expect(call?.subscription.record).not.toHaveProperty('previousSecret')
		expect(call?.subscription.record).not.toHaveProperty('headers')
		expect(JSON.stringify(call?.subscription)).not.toContain('t0ken')
	})

	it('runs the filter for a code subscription too, marked as such', async () => {
		await booted.payload.create({
			collection: 'posts',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		expect(seen.map((s) => s.subscription.source)).toEqual(['code'])
		expect(seen[0]?.subscription.id).toBe('ops')
	})

	it('passes the previous document on an update', async () => {
		await subscribe('a', ['posts.updated'])
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'before', tenant: 'a' },
			overrideAccess: true,
		})
		await booted.payload.update({
			collection: 'posts',
			id: post.id,
			data: { title: 'after' },
			overrideAccess: true,
		})
		const call = seen.find((s) => s.operation === 'update')
		expect(call?.doc.title).toBe('after')
		expect(call?.previousDoc?.title).toBe('before')
	})

	/** `scope` narrows the query itself, so the filter never even sees the other tenant's row. */
	it('narrows the candidates with scope', async () => {
		await subscribe('a', ['notes.created'])
		await subscribe('b', ['notes.created'])
		await booted.payload.create({
			collection: 'notes',
			data: { title: 'x', tenant: 'a' },
			overrideAccess: true,
		})
		expect(seen.map((s) => s.subscription.record.tenant)).toEqual(['a'])
		expect(hits).toEqual(['/a'])
	})

	it('treats a filter that throws as a rejection, and a scope that throws as no narrowing', async () => {
		await subscribe('a', ['broken.created'])
		await expect(
			booted.payload.create({
				collection: 'broken',
				data: { title: 'x', tenant: 'a' },
				overrideAccess: true,
			})
		).resolves.toBeDefined()
		expect(hits).toEqual([])
		expect(await deliveries()).toHaveLength(0)
	})
})
