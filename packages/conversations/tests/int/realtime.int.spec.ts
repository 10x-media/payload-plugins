import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { conversations, databaseBus, sseTransport } from '../../src/index'
import { parseEvents } from '../../src/react/sse'
import { boot, call, instanceOptions, type Session, signUp } from './fixture'

type Event = { data: Record<string, unknown>; event: string }

describeForDb('realtime over SSE', {}, (db) => {
	let booted: BootedPayload
	let staff: Session
	let customer: Session
	let personKey: string

	const tokenFor = async (session: Session, key: string) => {
		const res = await call<{ entries: Array<{ key: string; token: string }> }>(
			booted,
			'POST /conversations/comments/subscribe',
			{ body: { count: [], keys: [key] }, session }
		)
		return res.json.entries[0]?.token ?? ''
	}

	/** Open a stream; `next` waits for the next event (or null after `ms`). */
	const open = async (session: Session, body: { since?: string; tokens: string[] }) => {
		const abort = new AbortController()
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request('http://localhost:3000/api/conversations/comments/events', {
				body: JSON.stringify(body),
				headers: { Authorization: `JWT ${session.token}`, 'Content-Type': 'application/json' },
				method: 'POST',
				signal: abort.signal,
			}),
		})
		const reader = (res.body as ReadableStream<Uint8Array>).getReader()
		const decoder = new TextDecoder()
		const queue: Event[] = []
		let buffer = ''
		let pending: null | Promise<void> = null
		const pump = () => {
			pending ??= reader.read().then(({ done, value }) => {
				pending = null
				if (done) return
				buffer += decoder.decode(value, { stream: true })
				const parsed = parseEvents(buffer)
				buffer = parsed.rest
				for (const entry of parsed.events) {
					queue.push({ data: JSON.parse(entry.data), event: entry.event })
				}
			})
			return pending
		}
		const next = async (ms = 3000): Promise<Event | null> => {
			const until = Date.now() + ms
			while (queue.length === 0) {
				const left = until - Date.now()
				if (left <= 0) return null
				await Promise.race([pump(), new Promise((resolve) => setTimeout(resolve, left))])
			}
			return queue.shift() ?? null
		}
		const close = async () => {
			abort.abort()
			await reader.cancel().catch(() => undefined)
		}
		return { close, next, status: res.status }
	}

	beforeAll(async () => {
		booted = await boot(
			db,
			conversations(
				instanceOptions({ transport: sseTransport({ bus: databaseBus({ intervalMs: 200 }) }) })
			)
		)
		staff = await signUp(booted, 'users', 'Staff')
		customer = await signUp(booted, 'customers', 'Customer')
		const person = await booted.payload.create({
			collection: 'persons',
			data: { name: 'Live', owner: String(customer.id) },
		})
		personKey = `collection:persons:${person.id}`
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	describe('stream', () => {
		it('needs a signed-in user', async () => {
			const res = await call(booted, 'POST /conversations/comments/events', {
				body: { tokens: [] },
			})
			expect(res.status).toBe(401)
		})

		it('signals a change written in this process at once', async () => {
			const stream = await open(staff, { tokens: [await tokenFor(staff, personKey)] })
			expect((await stream.next())?.event).toBe('ready')
			await call(booted, 'POST /conversations/comments/messages', {
				body: { channel: 'internal', key: personKey, text: 'live' },
				session: staff,
			})
			expect(await stream.next()).toMatchObject({ data: { keys: [personKey] }, event: 'changed' })
			await stream.close()
		})

		it('hears another process through the database bus, within its channels', async () => {
			// A fresh key, so nothing the earlier tests wrote can answer for it.
			const person = await booted.payload.create({
				collection: 'persons',
				data: { name: 'Elsewhere', owner: String(customer.id) },
			})
			const key = `collection:persons:${person.id}`
			const staffStream = await open(staff, { tokens: [await tokenFor(staff, key)] })
			const customerStream = await open(customer, { tokens: [await tokenFor(customer, key)] })
			await staffStream.next()
			await customerStream.next()
			// Written straight to the database: no hooks, so no local publish, like another server.
			await booted.payload.db.create({
				collection: 'comments-messages',
				data: {
					authorKey: staff.userKey,
					channel: 'internal',
					clientId: crypto.randomUUID(),
					key,
					type: 'text',
				},
			})
			expect(await staffStream.next()).toMatchObject({ data: { keys: [key] }, event: 'changed' })
			// The customer cannot read `internal`: nothing for them.
			expect(await customerStream.next(800)).toBeNull()
			await staffStream.close()
			await customerStream.close()
		})

		it('reports what changed while it was away', async () => {
			const since = new Date(Date.now() - 60_000).toISOString()
			await call(booted, 'POST /conversations/comments/messages', {
				body: { channel: 'internal', key: personKey, text: 'while away' },
				session: staff,
			})
			const stream = await open(staff, { since, tokens: [await tokenFor(staff, personKey)] })
			expect((await stream.next())?.event).toBe('ready')
			expect(await stream.next()).toMatchObject({ data: { keys: [personKey] }, event: 'changed' })
			await stream.close()
		})

		it('refuses tokens of another user', async () => {
			const stream = await open(customer, { tokens: [await tokenFor(staff, personKey)] })
			const ready = await stream.next()
			expect(ready?.data.expired).toHaveLength(1)
			await stream.close()
		})
	})
})
