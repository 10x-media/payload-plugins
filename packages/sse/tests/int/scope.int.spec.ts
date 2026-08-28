import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest, Where } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { sse } from '../../src/index'
import { authorizeTopics } from '../../src/stream/authorizeTopics'
import { createRestClient, loginUser, openStream, readUntil } from './helpers/rest'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text', required: true },
	],
	access: { read: () => true },
}

const ownedPosts: CollectionConfig = {
	slug: 'owned-posts',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'tenant', type: 'text', required: true },
	],
	access: {
		read: ({ req }): Where | boolean => {
			const tenant = req.headers.get('x-tenant')
			if (!tenant) return false
			return { tenant: { equals: tenant } }
		},
	},
}

const headerScope = {
	resolveRequest: ({ req }: { req: PayloadRequest }) => req.headers.get('x-tenant'),
	resolveDoc: ({ doc }: { doc: unknown }) => {
		const tenant = (doc as { tenant?: unknown } | null)?.tenant
		return typeof tenant === 'string' ? tenant : null
	},
}

describeForDb('sse scope: namespaced wide topics', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let token: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({
				collections: { posts: true },
				scope: headerScope,
			}),
			db,
			collections: [users, posts],
		})
		token = await loginUser(booted, 'scope-ns@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('does not fan a tenant-b create to a tenant-a wide subscriber', async () => {
		const ac = new AbortController()
		const res = await openStream({
			booted,
			token,
			topics: 'posts',
			signal: ac.signal,
			headers: { 'x-tenant': 't1' },
		})
		expect(res.status).toBe(200)
		const reader = res.body?.getReader()
		if (!reader) throw new Error('missing body')
		await readUntil(reader, (buf) => buf.includes('event: ready'))

		await booted.payload.create({
			collection: 'posts',
			data: { title: 'b-only', tenant: 't2' },
		})
		const ours = await booted.payload.create({
			collection: 'posts',
			data: { title: 'a-visible', tenant: 't1' },
		})

		const body = await readUntil(reader, (buf) => buf.includes(`"docId":"${String(ours.id)}"`))
		expect(body).toContain('"topic":"posts"')
		expect(body).not.toContain('b-only')
		ac.abort()
		await reader.cancel().catch(() => {})
	})
})

describeForDb('sse scope: Where-wide gate and cross-tenant refuse', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let token: string
	let payload: Payload
	let ownedT1: { id: string | number }
	let ownedT2: { id: string | number }

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({
				collections: { 'owned-posts': true },
				presence: true,
				scope: headerScope,
			}),
			db,
			collections: [users, ownedPosts],
		})
		payload = booted.payload
		token = await loginUser(booted, 'scope-where@t.dev')
		ownedT1 = await payload.create({
			collection: 'owned-posts',
			data: { title: 't1-doc', tenant: 't1' },
			overrideAccess: true,
		})
		ownedT2 = await payload.create({
			collection: 'owned-posts',
			data: { title: 't2-doc', tenant: 't2' },
			overrideAccess: true,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const reqFor = (tenant: string): PayloadRequest =>
		({
			user: { id: 'u', email: 'scope-where@t.dev' },
			headers: new Headers({ 'x-tenant': tenant }),
			payload,
		}) as unknown as PayloadRequest

	it('allows a Where-scoped collection-wide topic with a per-event gate', async () => {
		const result = await authorizeTopics({
			req: reqFor('t1'),
			topics: ['owned-posts'],
			collections: { 'owned-posts': { thinEvents: true } },
			scope: headerScope,
		})
		expect(result).toEqual({
			ok: true,
			topics: [
				{
					topic: 'owned-posts',
					collection: 'owned-posts',
					mode: 'thin',
					scopes: ['t1'],
					gate: 'per-event',
				},
			],
		})
	})

	it('403s a document topic and presence join for another tenant', async () => {
		const doc = await authorizeTopics({
			req: reqFor('t1'),
			topics: [`owned-posts:${ownedT2.id}`],
			collections: { 'owned-posts': { thinEvents: true } },
			scope: headerScope,
		})
		expect(doc.ok).toBe(false)
		if (!doc.ok) expect(doc.status).toBe(403)

		const rest = createRestClient(booted)
		const presence = await rest.post('/api/realtime/presence', {
			body: { collection: 'owned-posts', id: String(ownedT2.id) },
			headers: { Authorization: `JWT ${token}`, 'x-tenant': 't1' },
		})
		expect(presence.status).toBe(403)
	})

	it('lets a same-scope delete through the wide topic without the document id', async () => {
		const ac = new AbortController()
		const res = await openStream({
			booted,
			token,
			topics: 'owned-posts',
			signal: ac.signal,
			headers: { 'x-tenant': 't1' },
		})
		expect(res.status).toBe(200)
		const reader = res.body?.getReader()
		if (!reader) throw new Error('missing body')
		await readUntil(reader, (buf) => buf.includes('event: ready'))

		await payload.delete({
			collection: 'owned-posts',
			id: ownedT1.id,
			overrideAccess: true,
		})

		const body = await readUntil(reader, (buf) => buf.includes('"operation":"delete"'))
		expect(body).toContain('"event":"delete"')
		expect(body).not.toContain(`"docId":"${String(ownedT1.id)}"`)
		ac.abort()
		await reader.cancel().catch(() => {})
	})
})
