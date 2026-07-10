import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'
import { sipgate } from '../../src/index'
import type { SipgateRestFetch } from '../../src/utils/sipgate.rest'
import { buildSipgateRest } from '../../src/utils/sipgate.rest'
import { syncChannels, syncDevices, syncUsers } from '../../src/utils/sipgateSyncHandlers'

// biome-ignore lint/plugin/noProcessEnv: test env boundary
const HAS_LIVE_CREDS = Boolean(process.env.SIPGATE_TOKEN && process.env.SIPGATE_TOKEN_ID)

const makeUsersMockRest = (
	userIds: string[],
	devicesByUserId: Record<string, string[]> = {},
	groupIds: string[] = []
): SipgateRestFetch => {
	const users = userIds.map((id) => ({
		id,
		firstname: id,
		lastname: 'Test',
		email: `${id}@test.com`,
		defaultDevice: '',
		admin: false,
		busyOnBusy: false,
		timezone: 'UTC',
		addressId: '',
	}))

	const groups = groupIds.map((id) => ({
		id,
		name: id,
		owner: userIds[0] ?? 'w0',
		createdAt: new Date().toISOString(),
		locale: 'en',
		settings: {},
		users: [],
	}))

	return async (url: string) => {
		if (url === '/users') {
			return new Response(JSON.stringify({ items: users }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}
		if (url === '/channels') {
			return new Response(JSON.stringify({ items: groups }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}
		const devicesMatch = url.match(/^\/([^/]+)\/devices$/)
		if (devicesMatch) {
			const userId = devicesMatch[1] ?? ''
			const deviceIds = devicesByUserId[userId] ?? []
			const items = deviceIds.map((id) => ({
				id,
				alias: id,
				type: 'REGISTER',
				online: true,
				dnd: false,
				activeGroups: [],
				activePhonelines: [],
			}))
			return new Response(JSON.stringify({ items }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}
		return new Response('{}', { status: 404 })
	}
}

describeForDb('syncUsers prune', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: sipgate({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('deletes orphaned user docs and keeps synced ones', async () => {
		const { payload } = booted
		const slug = 'sipgate-users'

		await payload.create({
			collection: slug,
			data: { sipgateId: 'w99', email: 'orphan@test.com' },
			overrideAccess: true,
		})

		const rest = makeUsersMockRest(['w0', 'w1'])
		await syncUsers({ payload, rest, sipgateUsersSlug: slug, prune: true })

		const remaining = await payload.find({
			collection: slug,
			overrideAccess: true,
			depth: 0,
		})
		const ids = remaining.docs.map((d) => (d as unknown as Record<string, unknown>).sipgateId)

		expect(ids).toContain('w0')
		expect(ids).toContain('w1')
		expect(ids).not.toContain('w99')
	})
})

describeForDb('syncDevices prune', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: sipgate({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('deletes orphaned device docs and keeps synced ones', async () => {
		const { payload } = booted
		const usersSlug = 'sipgate-users'
		const devicesSlug = 'sipgate-devices'

		await payload.create({
			collection: usersSlug,
			data: { sipgateId: 'w0', email: 'w0@test.com' },
			overrideAccess: true,
		})

		await payload.create({
			collection: devicesSlug,
			data: { sipgateId: 'd99', alias: 'Orphan Device' },
			overrideAccess: true,
		})

		const rest = makeUsersMockRest(['w0'], { w0: ['d0'] })
		await syncDevices({
			payload,
			rest,
			sipgateDevicesSlug: devicesSlug,
			sipgateUsersSlug: usersSlug,
			prune: true,
		})

		const remaining = await payload.find({
			collection: devicesSlug,
			overrideAccess: true,
			depth: 0,
		})
		const ids = remaining.docs.map((d) => (d as unknown as Record<string, unknown>).sipgateId)

		expect(ids).toContain('d0')
		expect(ids).not.toContain('d99')
	})
})

describeForDb('syncChannels prune', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: sipgate({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('deletes orphaned channel docs and keeps the synced ones', async () => {
		const { payload } = booted
		const channelsSlug = 'sipgate-channels'
		const usersSlug = 'sipgate-users'

		await payload.create({
			collection: channelsSlug,
			data: { sipgateId: 'g0', name: 'Synced Channel' },
			overrideAccess: true,
		})
		await payload.create({
			collection: channelsSlug,
			data: { sipgateId: 'g99', name: 'Orphan Channel' },
			overrideAccess: true,
		})

		const rest = makeUsersMockRest(['w0'], {}, ['g0'])
		await syncChannels({
			payload,
			rest,
			sipgateChannelsSlug: channelsSlug,
			sipgateUsersSlug: usersSlug,
			prune: true,
		})

		const remaining = await payload.find({
			collection: channelsSlug,
			overrideAccess: true,
			depth: 0,
		})
		const ids = remaining.docs.map((d) => (d as unknown as Record<string, unknown>).sipgateId)

		expect(ids).toContain('g0')
		expect(ids).not.toContain('g99')
	})
})

describe('syncUsers prune — live sipgate API', () => {
	test.skipIf(!HAS_LIVE_CREDS)(
		'deletes a fake orphan after a real sync, leaves real users intact',
		async () => {
			const { bootPayload: boot } = await import('@10x-media/payload-test-harness')
			const booted = await boot({ plugin: sipgate({}), db: 'mongo' })
			try {
				const { payload } = booted
				const slug = 'sipgate-users'

				await payload.create({
					collection: slug,
					data: {
						sipgateId: 'fake-orphan-does-not-exist-in-sipgate',
						email: 'fake@orphan.test',
					},
					overrideAccess: true,
				})

				const rest = buildSipgateRest({
					authType: 'pat',
					// biome-ignore lint/plugin/noProcessEnv: test env boundary
					tokenId: process.env.SIPGATE_TOKEN_ID,
					// biome-ignore lint/plugin/noProcessEnv: test env boundary
					token: process.env.SIPGATE_TOKEN,
				})

				await syncUsers({ payload, rest, sipgateUsersSlug: slug, prune: true })

				const remaining = await payload.find({
					collection: slug,
					overrideAccess: true,
					depth: 0,
				})
				const ids = remaining.docs.map((d) => (d as unknown as Record<string, unknown>).sipgateId)

				expect(ids).not.toContain('fake-orphan-does-not-exist-in-sipgate')
				expect(remaining.totalDocs).toBeGreaterThan(0)
			} finally {
				await booted.stop()
			}
		}
	)
})
