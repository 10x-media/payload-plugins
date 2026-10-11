import type { BootedPayload } from '@10x-media/payload-test-harness'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { conversations, pusherTransport } from '../../src/index'
import { browserPollerEnv } from '../../src/react/poller'
import { createPusherSource, type SocketConstructor } from '../../src/react/pusher'
import { pusherChannelName } from '../../src/shared/pusher'
import { boot, call, instanceOptions, type Session, signUp } from './fixture'

const APP = { appId: 'app-id', key: 'app-key', secret: 'app-secret' }

/** Resolves once `check` holds, polling every 50 ms; rejects after `ms`. */
const until = async (check: () => boolean, ms = 5000) => {
	const end = Date.now() + ms
	while (!check()) {
		if (Date.now() > end) throw new Error('Timed out')
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
}

// A real Pusher-compatible server (Soketi) in Docker: runs with the Docker tiers
// (`test:matrix`, `test:container`), once, on their Mongo leg.
// biome-ignore lint/plugin/noProcessEnv: test tier selection
const withDocker = process.env.DB_MATRIX?.split(',').includes('mongo') ?? false

describe.skipIf(!withDocker)('realtime over Pusher (Soketi)', () => {
	const db = 'mongo'
	let soketi: StartedTestContainer
	let port: number
	let booted: BootedPayload
	let staff: Session
	let customer: Session
	let personKey: string

	const tokenFor = async (session: Session, key: string) => {
		const res = await call<{ entries: Array<{ token: string }> }>(
			booted,
			'POST /conversations/comments/subscribe',
			{ body: { count: [], keys: [key] }, session }
		)
		return res.json.entries[0]?.token ?? ''
	}

	/** A browser's socket for `session`, following `channels` of the person. */
	const listen = async (session: Session, channels: string[]) => {
		const heard: string[][] = []
		let up = false
		const source = createPusherSource({
			env: browserPollerEnv(),
			handlers: {
				changed: (keys) => heard.push(keys),
				expired: () => undefined,
				health: (next) => {
					up = next
				},
			},
			instance: 'comments',
			options: { forceTLS: false, key: APP.key, wsHost: '127.0.0.1', wsPort: port },
			post: async (path, body) => {
				const res = await call(booted, `POST /conversations/comments${path}` as `POST /${string}`, {
					body,
					session,
				})
				if (res.status !== 200) throw new Error(String(res.status))
				return res.json as never
			},
			Socket: globalThis.WebSocket as unknown as SocketConstructor,
		})
		source.watch([{ channels, key: personKey, token: await tokenFor(session, personKey) }], null)
		await until(() => up)
		// Subscriptions are authorized and confirmed after the socket opens.
		await new Promise((resolve) => setTimeout(resolve, 500))
		return { heard, source }
	}

	beforeAll(async () => {
		soketi = await new GenericContainer('quay.io/soketi/soketi:1.6-16-debian')
			.withEnvironment({
				SOKETI_DEFAULT_APP_ID: APP.appId,
				SOKETI_DEFAULT_APP_KEY: APP.key,
				SOKETI_DEFAULT_APP_SECRET: APP.secret,
			})
			.withExposedPorts(6001)
			.withWaitStrategy(Wait.forListeningPorts())
			.start()
		port = soketi.getMappedPort(6001)
		booted = await boot(
			db,
			conversations(
				instanceOptions({
					transport: pusherTransport({ ...APP, host: '127.0.0.1', port, useTLS: false }),
				})
			)
		)
		staff = await signUp(booted, 'users', 'Staff')
		customer = await signUp(booted, 'customers', 'Customer')
		const person = await booted.payload.create({
			collection: 'persons',
			data: { name: 'Pushed', owner: String(customer.id) },
		})
		personKey = `collection:persons:${person.id}`
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
		await soketi?.stop()
	})

	it('signals a sent message through the service, only to readers of its channel', async () => {
		const staffSide = await listen(staff, ['internal', 'shared'])
		const customerSide = await listen(customer, ['shared'])
		await call(booted, 'POST /conversations/comments/messages', {
			body: { channel: 'internal', key: personKey, text: 'staff only' },
			session: staff,
		})
		await until(() => staffSide.heard.length > 0)
		expect(staffSide.heard[0]).toEqual([personKey])
		await call(booted, 'POST /conversations/comments/messages', {
			body: { channel: 'shared', key: personKey, text: 'for everyone' },
			session: staff,
		})
		await until(() => customerSide.heard.length > 0)
		// The customer heard the shared message only, never the internal one.
		expect(customerSide.heard).toEqual([[personKey]])
		staffSide.source.destroy()
		customerSide.source.destroy()
	}, 30_000)

	it('refuses to authorize a channel the token does not cover', async () => {
		const res = await call(booted, 'POST /conversations/comments/pusher-auth', {
			body: {
				channelName: pusherChannelName('comments', personKey, 'internal'),
				socketId: '123.456',
				token: await tokenFor(customer, personKey),
			},
			session: customer,
		})
		expect(res.status).toBe(403)
	})
})
