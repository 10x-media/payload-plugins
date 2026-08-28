import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { sse } from '../../src/index'
import { createRestClient, loginUser, openStream, readUntil } from './helpers/rest'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [{ name: 'title', type: 'text' }],
	access: { read: () => true },
}

describeForDb('sse cross-db smoke', {}, (db) => {
	let booted: BootedPayload
	let tokenA: string
	let tokenB: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({
				collections: { posts: true },
				presence: true,
				admin: true,
			}),
			db,
			collections: [users, posts],
		})
		tokenA = await loginUser(booted, `matrix-a-${db}@t.dev`)
		tokenB = await loginUser(booted, `matrix-b-${db}@t.dev`)
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it(`authenticated stream receives create on ${db}`, async () => {
		const ac = new AbortController()
		const res = await openStream({
			booted,
			token: tokenA,
			topics: 'posts',
			signal: ac.signal,
		})
		expect(res.status).toBe(200)
		const reader = res.body?.getReader()
		if (!reader) throw new Error('missing body')

		await readUntil(reader, (buf) => buf.includes('event: ready'))

		const created = await booted.payload.create({
			collection: 'posts',
			data: { title: `matrix-${db}` },
		})

		const body = await readUntil(reader, (buf) => buf.includes('"operation":"create"'))
		expect(body).toContain('event: create')
		expect(body).toContain(`"docId":"${String(created.id)}"`)

		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it(`presence POST returns peers on ${db}`, async () => {
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: `presence-${db}` },
		})
		const postId = String(post.id)
		const rest = createRestClient(booted)

		const joinA = await rest.request('POST', '/api/realtime/presence', {
			body: { collection: 'posts', id: postId },
			headers: { Authorization: `JWT ${tokenA}` },
		})
		expect(joinA.status).toBe(200)

		const joinB = await rest.request('POST', '/api/realtime/presence', {
			body: { collection: 'posts', id: postId },
			headers: { Authorization: `JWT ${tokenB}` },
		})
		expect(joinB.status).toBe(200)
		const bodyB = (await joinB.json()) as { peers: Array<{ id: string; label: string }> }
		expect(bodyB.peers.length).toBeGreaterThanOrEqual(2)

		await rest.request('DELETE', '/api/realtime/presence', {
			body: { collection: 'posts', id: postId },
			headers: { Authorization: `JWT ${tokenA}` },
		})
		await rest.request('DELETE', '/api/realtime/presence', {
			body: { collection: 'posts', id: postId },
			headers: { Authorization: `JWT ${tokenB}` },
		})
	})
})
