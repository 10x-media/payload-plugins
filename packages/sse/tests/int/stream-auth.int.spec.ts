import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { InProcessBroker } from '../../src/broker/InProcessBroker'
import { sse } from '../../src/index'
import { makeStreamHandler } from '../../src/stream/makeStreamHandler'

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

const posts: CollectionConfig = {
	slug: 'posts',
	fields: [{ name: 'title', type: 'text' }],
	access: { read: () => true },
}

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'users', data: { email, password } })
	const result = await payload.login({ collection: 'users', data: { email, password } })
	return result.user
}

const readUntilReady = async (res: Response): Promise<string> => {
	const reader = res.body?.getReader()
	if (!reader) throw new Error('missing body')
	const decoder = new TextDecoder()
	let out = ''
	while (!out.includes('event: ready')) {
		const { done, value } = await reader.read()
		if (done) break
		out += decoder.decode(value, { stream: true })
	}
	await reader.cancel()
	return out
}

describeForDb('sse stream auth', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<typeof login>>
	let broker: InProcessBroker

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({}),
			db,
			collections: [users, posts],
		})
		user = await login(booted.payload, 'stream@t.dev')
		broker = new InProcessBroker()
	}, 240_000)

	afterAll(async () => {
		await broker.destroy()
		await booted.stop()
	})

	const handler = () =>
		makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
		})

	const reqFor = (opts: {
		user?: unknown
		topics?: string
		signal?: AbortSignal
	}): PayloadRequest => {
		const topics = opts.topics ?? 'posts'
		return {
			user: opts.user,
			url: `http://localhost/api/realtime/stream?topics=${encodeURIComponent(topics)}`,
			payload: booted.payload,
			...(opts.signal ? { signal: opts.signal } : {}),
		} as unknown as PayloadRequest
	}

	it('401s an anonymous request', async () => {
		const res = await handler()(reqFor({ user: undefined }))
		expect(res.status).toBe(401)
	})

	it('returns 200 with a ready frame for an authenticated user', async () => {
		const ac = new AbortController()
		const res = await handler()(reqFor({ user, signal: ac.signal }))
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
		const body = await readUntilReady(res)
		expect(body).toContain('event: ready')
		expect(body).toContain('"topic":"posts"')
		ac.abort()
	})
})
