import { type BootedPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
	conversations,
	databaseBus,
	getInstance,
	payloadKVBus,
	sseTransport,
} from '../../src/index'
import { boot, call, instanceOptions, openStream, type Session, signUp } from './fixture'

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

	const open = (session: Session, body: { since?: string; tokens: string[] }) =>
		openStream(booted, { body, instance: 'comments', session })

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

describeForDb('realtime over SSE with the Payload KV bus', {}, (db) => {
	let booted: BootedPayload
	let staff: Session

	beforeAll(async () => {
		booted = await boot(
			db,
			conversations(
				instanceOptions({
					transport: sseTransport({ bus: payloadKVBus({ fullCheckMs: 60_000, intervalMs: 200 }) }),
				})
			)
		)
		staff = await signUp(booted, 'users', 'Staff')
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it('queries only once the KV flag moved', async () => {
		const person = await booted.payload.create({ collection: 'persons', data: { name: 'KV' } })
		const key = `collection:persons:${person.id}`
		const token = (
			await call<{ entries: Array<{ token: string }> }>(
				booted,
				'POST /conversations/comments/subscribe',
				{ body: { count: [], keys: [key] }, session: staff }
			)
		).json.entries[0]?.token
		const stream = await openStream(booted, {
			body: { tokens: [token ?? ''] },
			instance: 'comments',
			session: staff,
		})
		expect((await stream.next())?.event).toBe('ready')
		// Let the first full check pass, so only the flag can trigger the next query.
		await new Promise((resolve) => setTimeout(resolve, 500))
		const write = () =>
			booted.payload.db.create({
				collection: 'comments-messages',
				data: {
					authorKey: staff.userKey,
					channel: 'internal',
					clientId: crypto.randomUUID(),
					key,
					type: 'text',
				},
			})
		// Another process writes without bumping the flag: nobody looks.
		await write()
		expect(await stream.next(800)).toBeNull()
		// Another process writes and bumps it, as its `publish` does.
		await write()
		await payloadKVBus().publish?.({
			instance: getInstance({ payload: booted.payload }, 'comments'),
			payload: booted.payload,
			signal: { channel: 'internal', key },
		})
		expect(await stream.next()).toMatchObject({ data: { keys: [key] }, event: 'changed' })
		await stream.close()
	})
})
