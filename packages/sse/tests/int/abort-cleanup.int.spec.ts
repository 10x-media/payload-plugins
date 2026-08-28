import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { InProcessBroker } from '../../src/broker/InProcessBroker'
import type { RealtimeEvent } from '../../src/broker/types'
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

const readUntil = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	predicate: (buf: string) => boolean
): Promise<string> => {
	const decoder = new TextDecoder()
	let out = ''
	while (!predicate(out)) {
		const { done, value } = await reader.read()
		if (done) break
		out += decoder.decode(value, { stream: true })
	}
	return out
}

describeForDb('sse abort cleanup', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<typeof login>>
	let broker: InProcessBroker

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sse({}),
			db,
			collections: [users, posts],
		})
		user = await login(booted.payload, 'abort@t.dev')
		broker = new InProcessBroker()
	}, 240_000)

	afterAll(async () => {
		await broker.destroy()
		await booted.stop()
	})

	const openStream = async (signal: AbortSignal) => {
		const handler = makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
		})
		const req = {
			user,
			url: 'http://localhost/api/realtime/stream?topics=posts',
			payload: booted.payload,
			signal,
		} as unknown as PayloadRequest
		return handler(req)
	}

	it('unsubscribes on abort so publishes skip the dead consumer; a fresh stream still receives', async () => {
		const firstAc = new AbortController()
		const firstRes = await openStream(firstAc.signal)
		expect(firstRes.status).toBe(200)
		const firstReader = firstRes.body?.getReader()
		if (!firstReader) throw new Error('missing body')

		let firstBuf = await readUntil(firstReader, (b) => b.includes('event: ready'))
		expect(firstBuf).toContain('event: ready')

		firstAc.abort()
		await new Promise((r) => setTimeout(r, 30))

		broker.publish({
			id: 'after-abort',
			topic: 'posts',
			event: 'update',
			timestamp: Date.now(),
		})

		const drain = await Promise.race([
			firstReader.read().then((chunk) => {
				if (chunk.value) {
					firstBuf += new TextDecoder().decode(chunk.value, { stream: true })
				}
				return firstBuf
			}),
			new Promise<string>((resolve) => setTimeout(() => resolve(firstBuf), 80)),
		])
		expect(drain).not.toContain('id: after-abort')
		await firstReader.cancel().catch(() => undefined)

		const secondAc = new AbortController()
		const secondRes = await openStream(secondAc.signal)
		expect(secondRes.status).toBe(200)
		const secondReader = secondRes.body?.getReader()
		if (!secondReader) throw new Error('missing body')

		await readUntil(secondReader, (b) => b.includes('event: ready'))

		const event: RealtimeEvent = {
			id: 'fresh',
			topic: 'posts',
			event: 'update',
			collection: 'posts',
			timestamp: Date.now(),
		}
		const secondPromise = readUntil(secondReader, (b) => b.includes('id: fresh'))
		broker.publish(event)
		const secondBuf = await secondPromise
		expect(secondBuf).toContain('id: fresh')
		expect(secondBuf).toContain('event: update')
		secondAc.abort()
		await secondReader.cancel().catch(() => undefined)
	})
})
