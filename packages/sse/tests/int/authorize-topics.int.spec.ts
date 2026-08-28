import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest, Where } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { InProcessBroker } from '../../src/broker/InProcessBroker'
import { sse } from '../../src/index'
import { authorizeTopics } from '../../src/stream/authorizeTopics'
import { makeStreamHandler } from '../../src/stream/makeStreamHandler'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const ownedPosts: CollectionConfig = {
	slug: 'owned-posts',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'ownerEmail', type: 'text', required: true },
	],
	access: {
		read: ({ req }): Where | boolean => {
			const email = (req.user as { email?: string } | null)?.email
			if (!email) return false
			return { ownerEmail: { equals: email } }
		},
	},
}

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'users', data: { email, password } })
	const result = await payload.login({ collection: 'users', data: { email, password } })
	return result.user
}

describeForDb('sse authorize topics int', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let owner: Awaited<ReturnType<typeof login>>
	let other: Awaited<ReturnType<typeof login>>
	let ownedId: string | number
	let broker: InProcessBroker

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({}),
			db,
			collections: [users, ownedPosts],
		})
		owner = await login(booted.payload, 'owner@t.dev')
		other = await login(booted.payload, 'other@t.dev')
		const doc = await booted.payload.create({
			collection: 'owned-posts',
			data: { title: 'mine', ownerEmail: 'owner@t.dev' },
			overrideAccess: true,
		})
		ownedId = doc.id
		broker = new InProcessBroker()
	}, 240_000)

	afterAll(async () => {
		await broker.destroy()
		await booted.stop()
	})

	const reqFor = (user: unknown): PayloadRequest =>
		({
			user,
			payload: booted.payload,
		}) as unknown as PayloadRequest

	const handler = () =>
		makeStreamHandler({
			broker,
			collections: { 'owned-posts': { thinEvents: true } },
			heartbeatMs: 60_000,
		})

	it('returns 400 for zero topics via the handler', async () => {
		const res = await handler()({
			user: owner,
			url: 'http://localhost/api/realtime/stream?topics=',
			payload: booted.payload,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(400)
	})

	it('returns 400 for 33 topics via the handler', async () => {
		const topics = Array.from({ length: 33 }, (_, i) => `owned-posts:${i}`).join(',')
		const res = await handler()({
			user: owner,
			url: `http://localhost/api/realtime/stream?topics=${encodeURIComponent(topics)}`,
			payload: booted.payload,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(400)
	})

	it('returns 403 for an unknown collection', async () => {
		const res = await handler()({
			user: owner,
			url: 'http://localhost/api/realtime/stream?topics=nope',
			payload: booted.payload,
		} as unknown as PayloadRequest)
		expect(res.status).toBe(403)
	})

	it('refuses Where-scoped collection-wide topic but allows an owned document topic', async () => {
		const refuseWide = await authorizeTopics({
			req: reqFor(owner),
			topics: ['owned-posts'],
			collections: { 'owned-posts': { thinEvents: true } },
		})
		expect(refuseWide.ok).toBe(false)
		if (!refuseWide.ok) expect(refuseWide.status).toBe(403)

		const owned = await authorizeTopics({
			req: reqFor(owner),
			topics: [`owned-posts:${ownedId}`],
			collections: { 'owned-posts': { thinEvents: true } },
		})
		expect(owned).toEqual({
			ok: true,
			topics: [
				{
					topic: `owned-posts:${ownedId}`,
					collection: 'owned-posts',
					docId: String(ownedId),
					mode: 'thin',
				},
			],
		})

		const unowned = await authorizeTopics({
			req: reqFor(other),
			topics: [`owned-posts:${ownedId}`],
			collections: { 'owned-posts': { thinEvents: true } },
		})
		expect(unowned.ok).toBe(false)
		if (!unowned.ok) expect(unowned.status).toBe(403)
	})
})
