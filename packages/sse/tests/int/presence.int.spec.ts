import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { sse } from '../../src/index'
import { createRestClient, loginUser } from './helpers/rest'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [{ name: 'title', type: 'text' }],
	access: { read: () => true },
}

describeForDb('sse presence', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let tokenA: string
	let tokenB: string
	let postId: string

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({
				collections: { posts: true },
				presence: true,
			}),
			db,
			collections: [users, posts],
		})
		tokenA = await loginUser(booted, 'presence-a@t.dev')
		tokenB = await loginUser(booted, 'presence-b@t.dev')
		const post = await booted.payload.create({
			collection: 'posts',
			data: { title: 'watched' },
		})
		postId = String(post.id)
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const presence = (
		token: string,
		method: 'POST' | 'DELETE',
		body: { collection: string; id: string }
	) => {
		const rest = createRestClient(booted)
		return rest.request(method, '/api/realtime/presence', {
			body,
			headers: { Authorization: `JWT ${token}` },
		})
	}

	it('401s anonymous presence POST', async () => {
		const rest = createRestClient(booted)
		const res = await rest.post('/api/realtime/presence', {
			body: { collection: 'posts', id: postId },
		})
		expect(res.status).toBe(401)
	})

	it('two users join; B sees A; leave removes peer; no email on the wire', async () => {
		const joinA = await presence(tokenA, 'POST', { collection: 'posts', id: postId })
		expect(joinA.status).toBe(200)
		const bodyA = (await joinA.json()) as {
			peers: Array<{ id: string; label: string; email?: string }>
			self?: { id: string; label: string; email?: string }
		}
		expect(bodyA.peers).toHaveLength(1)
		expect(JSON.stringify(bodyA)).not.toContain('email')
		expect(bodyA.self?.email).toBeUndefined()

		const joinB = await presence(tokenB, 'POST', { collection: 'posts', id: postId })
		expect(joinB.status).toBe(200)
		const bodyB = (await joinB.json()) as {
			peers: Array<{ id: string; label: string }>
		}
		expect(bodyB.peers).toHaveLength(2)
		expect(JSON.stringify(bodyB)).not.toContain('email')
		expect(bodyB.peers.every((p) => typeof p.id === 'string' && typeof p.label === 'string')).toBe(
			true
		)

		const leaveA = await presence(tokenA, 'DELETE', { collection: 'posts', id: postId })
		expect(leaveA.status).toBe(200)
		const afterLeave = (await leaveA.json()) as { peers: Array<{ id: string }> }
		expect(afterLeave.peers).toHaveLength(1)

		const stillB = await presence(tokenB, 'POST', { collection: 'posts', id: postId })
		const stillBody = (await stillB.json()) as { peers: Array<{ id: string }> }
		expect(stillBody.peers).toHaveLength(1)

		await presence(tokenB, 'DELETE', { collection: 'posts', id: postId })
	})
})
