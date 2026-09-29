import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { type AccessArgs, type CollectionConfig, type GlobalConfig, handleEndpoints } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { ContentLockedError, contentLock, getContentLockState } from '../../src/index'
import { forgetWindows, SNAPSHOT_KEY } from '../../src/state/store'

const LOCKS = 'content-locks'
const ORIGIN = 'http://localhost:3000'
const START = new Date('2026-01-10T10:00:00.000Z')

const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }
const posts: CollectionConfig = {
	slug: 'posts',
	access: { update: () => ({ title: { equals: 'mine' } }) },
	fields: [{ name: 'title', type: 'text' }],
}
const products: CollectionConfig = { slug: 'products', fields: [{ name: 'name', type: 'text' }] }
const submissions: CollectionConfig = {
	slug: 'submissions',
	access: { create: () => true },
	fields: [{ name: 'body', type: 'text' }],
}
const header: GlobalConfig = { slug: 'header', fields: [{ name: 'text', type: 'text' }] }

describeForDb('content-lock enforcement', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	let user: Awaited<ReturnType<BootedPayload['payload']['create']>>

	const payload = () => booted.payload

	const lock = (data: Record<string, unknown> = {}) =>
		payload().create({
			collection: LOCKS,
			data: { title: 'Maintenance', ...data },
			overrideAccess: true,
		})

	const rest = (path: string, init: RequestInit = {}) =>
		handleEndpoints({
			config: payload().config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${ORIGIN}/api${path}`, {
				...init,
				headers: { 'Content-Type': 'application/json', ...init.headers },
			}),
		})

	beforeAll(async () => {
		clock = installTestClock(START)
		booted = await bootPayload({
			db,
			collections: [users, posts, products, submissions],
			configOverrides: {
				globals: [header],
				admin: { user: 'users' },
				endpoints: [
					{
						path: '/touch',
						method: 'post',
						handler: async (req) => {
							await req.payload.create({ collection: 'posts', data: { title: 'x' }, req })
							return Response.json({ ok: true })
						},
					},
				],
			},
			plugin: contentLock({
				groups: [{ key: 'catalog', label: 'Catalog', collections: ['products'] }],
				exempt: ['submissions'],
				individualSelection: true,
			}),
		})
		user = await payload().create({
			collection: 'users',
			data: { email: 'dev@10xmedia.de', password: 'password' },
		})
	})

	beforeEach(() => {
		clock.set(START)
	})

	afterEach(async () => {
		await payload().delete({
			collection: LOCKS,
			where: { id: { exists: true } },
			overrideAccess: true,
		})
	})

	afterAll(async () => {
		clock.reset()
		await booted.stop()
	})

	it('rejects Local API writes, even with overrideAccess', async () => {
		await lock()
		const attempt = payload().create({
			collection: 'posts',
			data: { title: 'blocked' },
			overrideAccess: true,
		})
		await expect(attempt).rejects.toBeInstanceOf(ContentLockedError)
		await expect(attempt).rejects.toMatchObject({ status: 503 })
	})

	it('answers REST writes with 503 and Retry-After', async () => {
		await lock()
		const res = await rest('/posts', { method: 'POST', body: JSON.stringify({ title: 'x' }) })
		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('3600')
	})

	it('answers a custom endpoint that writes with 503 and Retry-After', async () => {
		await lock()
		const res = await rest('/touch', { method: 'POST', body: '{}' })
		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('3600')
	})

	it('blocks global updates', async () => {
		await lock()
		await expect(
			payload().updateGlobal({ slug: 'header', data: { text: 'x' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
	})

	it('keeps exempt, lock and preference collections writable', async () => {
		await lock()
		await expect(
			payload().create({ collection: 'submissions', data: { body: 'hi' } })
		).resolves.toBeDefined()
		await expect(lock({ title: 'Another' })).resolves.toBeDefined()
		await expect(
			payload().create({
				collection: 'payload-preferences',
				data: { key: 'k', value: 1 },
				overrideAccess: true,
				user: { ...user, collection: 'users' },
			})
		).resolves.toBeDefined()
	})

	it('still lets people log in', async () => {
		await lock()
		const result = await payload().login({
			collection: 'users',
			data: { email: 'dev@10xmedia.de', password: 'password' },
		})
		expect(result.token).toBeTruthy()
	})

	it('freezes only a selected group', async () => {
		await lock({ lockEverything: false, groups: ['catalog'] })
		await expect(
			payload().create({ collection: 'products', data: { name: 'x' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
		await expect(
			payload().create({ collection: 'posts', data: { title: 'free' }, overrideAccess: true })
		).resolves.toBeDefined()
	})

	it('freezes an individually selected collection', async () => {
		await lock({ lockEverything: false, collections: ['posts'] })
		await expect(
			payload().create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		).rejects.toBeInstanceOf(ContentLockedError)
		await expect(
			payload().create({ collection: 'products', data: { name: 'x' }, overrideAccess: true })
		).resolves.toBeDefined()
	})

	it('activates and ends a scheduled window by time', async () => {
		await lock({
			announceAt: '2026-01-10T11:00:00.000Z',
			startsAt: '2026-01-10T12:00:00.000Z',
			endAtTime: true,
			endsAt: '2026-01-10T13:00:00.000Z',
		})
		const write = () =>
			payload().create({ collection: 'posts', data: { title: 't' }, overrideAccess: true })
		await expect(write()).resolves.toBeDefined()
		clock.set(new Date('2026-01-10T11:30:00.000Z'))
		expect((await getContentLockState(payload())).announced).toHaveLength(1)
		clock.set(new Date('2026-01-10T12:00:00.000Z'))
		await expect(write()).rejects.toBeInstanceOf(ContentLockedError)
		clock.set(new Date('2026-01-10T13:00:00.000Z'))
		await expect(write()).resolves.toBeDefined()
	})

	it('unlocks when a window is ended now', async () => {
		const window = await lock()
		await payload().update({
			collection: LOCKS,
			id: window.id,
			data: { endedAt: START.toISOString() },
			overrideAccess: true,
		})
		await expect(
			payload().create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		).resolves.toBeDefined()
	})

	it('stamps startsAt and rejects an announcement after the start', async () => {
		const window = await lock()
		expect(window.startsAt).toBe(START.toISOString())
		await expect(
			lock({ announceAt: '2026-01-12T00:00:00.000Z', startsAt: '2026-01-11T00:00:00.000Z' })
		).rejects.toMatchObject({ status: 400 })
	})

	it('denies write access in scope and passes the original result through otherwise', async () => {
		const update = payload().collections.posts?.config.access.update
		if (!update) {
			throw new Error('posts collection missing')
		}
		const args = { req: { payload: payload(), context: {}, user: null } } as unknown as AccessArgs
		expect(await update(args)).toEqual({ title: { equals: 'mine' } })
		await lock()
		expect(await update(args)).toBe(false)
	})

	it('rebuilds a missing snapshot from the collection', async () => {
		await lock()
		await payload().kv.delete(SNAPSHOT_KEY)
		forgetWindows(payload())
		expect((await getContentLockState(payload())).locked).toBe(true)
	})
})
