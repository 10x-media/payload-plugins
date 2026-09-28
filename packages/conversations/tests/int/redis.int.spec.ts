import type { BootedPayload } from '@10x-media/payload-test-harness'
import { Redis } from 'ioredis'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { conversations, getInstance, ioredisPubSub, redisBus, sseTransport } from '../../src/index'
import { boot, call, instanceOptions, openStream, type Session, signUp } from './fixture'

// A real Redis in Docker: runs with the Docker tiers (`test:matrix`, `test:container`),
// once, on their Mongo leg.
// biome-ignore lint/plugin/noProcessEnv: test tier selection
const withDocker = process.env.DB_MATRIX?.split(',').includes('mongo') ?? false

describe.skipIf(!withDocker)('realtime over SSE with the Redis bus', () => {
	let redis: StartedTestContainer
	const clients: Redis[] = []
	let booted: BootedPayload
	let staff: Session
	let personKey: string

	const client = () => {
		const next = new Redis(redis.getMappedPort(6379), redis.getHost())
		clients.push(next)
		return next
	}

	const tokenFor = async (session: Session, key: string) => {
		const res = await call<{ entries: Array<{ token: string }> }>(
			booted,
			'POST /conversations/comments/subscribe',
			{ body: { count: [], keys: [key] }, session }
		)
		return res.json.entries[0]?.token ?? ''
	}

	beforeAll(async () => {
		redis = await new GenericContainer('redis:7-alpine')
			.withExposedPorts(6379)
			.withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
			.start()
		booted = await boot(
			'mongo',
			conversations(
				instanceOptions({
					transport: sseTransport({
						bus: redisBus(ioredisPubSub(client(), client()), { fallbackCheckMs: false }),
					}),
				})
			)
		)
		staff = await signUp(booted, 'users', 'Staff')
		const person = await booted.payload.create({ collection: 'persons', data: { name: 'Redis' } })
		personKey = `collection:persons:${person.id}`
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
		for (const entry of clients) entry.disconnect()
		await redis?.stop()
	})

	it('hears a change another process published, in milliseconds', async () => {
		const stream = await openStream(booted, {
			body: { tokens: [await tokenFor(staff, personKey)] },
			instance: 'comments',
			session: staff,
		})
		expect((await stream.next())?.event).toBe('ready')
		// Give the subscription a moment to reach Redis.
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Another server process: its own bus on its own connections.
		const elsewhere = redisBus(ioredisPubSub(client(), client()), { fallbackCheckMs: false })
		const started = Date.now()
		await elsewhere.publish?.({
			instance: getInstance({ payload: booted.payload }, 'comments'),
			payload: booted.payload,
			signal: { channel: 'internal', key: personKey },
		})
		expect(await stream.next(1000)).toMatchObject({
			data: { keys: [personKey] },
			event: 'changed',
		})
		expect(Date.now() - started).toBeLessThan(500)
		await stream.close()
	})

	it('does not hear its own messages twice', async () => {
		const stream = await openStream(booted, {
			body: { tokens: [await tokenFor(staff, personKey)] },
			instance: 'comments',
			session: staff,
		})
		await stream.next()
		await new Promise((resolve) => setTimeout(resolve, 200))
		await call(booted, 'POST /conversations/comments/messages', {
			body: { channel: 'internal', key: personKey, text: 'once' },
			session: staff,
		})
		expect((await stream.next())?.event).toBe('changed')
		expect(await stream.next(500)).toBeNull()
		await stream.close()
	})
})
