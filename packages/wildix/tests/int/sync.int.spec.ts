import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type {
	ListUserDevicesCommand as ListUserDevicesCommandType,
	PbxCallGroup,
	PbxColleague,
	WmsApiClient,
} from '@wildix/wms-api-client'
import {
	GetPbxCallGroupsCommand,
	GetPbxColleaguesCommand,
	ListUserDevicesCommand,
} from '@wildix/wms-api-client'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { wildix } from '../../src/index'
import { syncChannels, syncDevices, syncUsers } from '../../src/utils/wildixSyncHandlers'

type MockFixtures = {
	colleagues?: Partial<PbxColleague>[]
	devicesByExtension?: Record<string, { contact: string; userAgent: string; active: boolean }[]>
	activeDeviceByExtension?: Record<string, string>
	callGroups?: Partial<PbxCallGroup>[]
}

/** Duck-types a WmsApiClient by pattern-matching on the command class sent to it. */
const buildMockWmsClient = ({
	colleagues = [],
	devicesByExtension = {},
	activeDeviceByExtension = {},
	callGroups = [],
}: MockFixtures): WmsApiClient => {
	const send = async (command: unknown) => {
		if (command instanceof GetPbxColleaguesCommand) {
			return { type: 'result', result: { records: colleagues, total: colleagues.length } }
		}
		if (command instanceof ListUserDevicesCommand) {
			const { user } = (command as ListUserDevicesCommandType).input
			const devices = devicesByExtension[user as string] ?? []
			const activeContact = activeDeviceByExtension[user as string]
			const activeDevice = devices.find((d) => d.contact === activeContact)
			return { devices, activeDevice }
		}
		if (command instanceof GetPbxCallGroupsCommand) {
			return { type: 'result', result: { records: callGroups, total: callGroups.length } }
		}
		throw new Error(
			`Unhandled command in mock WmsApiClient: ${(command as object)?.constructor?.name}`
		)
	}
	return { send } as unknown as WmsApiClient
}

describeForDb('syncUsers', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: wildix({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('upserts colleagues and prunes orphaned user docs', async () => {
		const { payload } = booted
		const slug = 'wildix-users'

		await payload.create({
			collection: slug,
			data: { wildixId: 'orphan-99', email: 'orphan@test.com', extension: '999' },
			overrideAccess: true,
		})

		const client = buildMockWmsClient({
			colleagues: [
				{ id: 'w0', name: 'Alice', email: 'alice@test.com', extension: '100' },
				{ id: 'w1', name: 'Bob', email: 'bob@test.com', extension: '101' },
			],
		})

		const result = await syncUsers({ payload, client, wildixUsersSlug: slug, prune: true })
		expect(result).toMatchObject({ synced: 2, errors: 0, deleted: 1 })

		const remaining = await payload.find({ collection: slug, overrideAccess: true, depth: 0 })
		const ids = remaining.docs.map((d) => (d as unknown as Record<string, unknown>).wildixId)
		expect(ids).toContain('w0')
		expect(ids).toContain('w1')
		expect(ids).not.toContain('orphan-99')
	})
})

describeForDb('syncDevices', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: wildix({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('upserts devices keyed by contact, marks the active device, and prunes orphans', async () => {
		const { payload } = booted
		const usersSlug = 'wildix-users'
		const devicesSlug = 'wildix-devices'

		await payload.create({
			collection: usersSlug,
			data: { wildixId: 'w0', email: 'w0@test.com', extension: '100' },
			overrideAccess: true,
		})
		await payload.create({
			collection: devicesSlug,
			data: { contact: 'orphan-contact', userAgent: 'Old Phone', online: false },
			overrideAccess: true,
		})

		const client = buildMockWmsClient({
			devicesByExtension: {
				'100': [
					{ contact: 'sip:100@desk', userAgent: 'Yealink T54W', active: true },
					{ contact: 'sip:100@mobile', userAgent: 'x-bees Mobile', active: false },
				],
			},
			activeDeviceByExtension: { '100': 'sip:100@desk' },
		})

		const result = await syncDevices({
			payload,
			client,
			wildixDevicesSlug: devicesSlug,
			wildixUsersSlug: usersSlug,
			prune: true,
		})
		expect(result).toMatchObject({ synced: 2, errors: 0, deleted: 1 })

		const remaining = await payload.find({
			collection: devicesSlug,
			overrideAccess: true,
			depth: 0,
		})
		const byContact = new Map(
			remaining.docs.map((d) => {
				const doc = d as unknown as Record<string, unknown>
				return [doc.contact as string, doc]
			})
		)

		expect(byContact.has('orphan-contact')).toBe(false)
		expect(byContact.get('sip:100@desk')).toMatchObject({ isActiveDevice: true })
		expect(byContact.get('sip:100@mobile')).toMatchObject({ isActiveDevice: false })
	})

	it('skips prune and only syncs the given user when scopeToUserId is set', async () => {
		const { payload } = booted
		const usersSlug = 'wildix-users'
		const devicesSlug = 'wildix-devices'

		await payload.create({
			collection: usersSlug,
			data: { wildixId: 'w2', email: 'w2@test.com', extension: '102' },
			overrideAccess: true,
		})

		const client = buildMockWmsClient({
			devicesByExtension: { '102': [{ contact: 'sip:102@desk', userAgent: 'Desk', active: true }] },
		})

		const result = await syncDevices({
			payload,
			client,
			wildixDevicesSlug: devicesSlug,
			wildixUsersSlug: usersSlug,
			prune: true,
			scopeToUserId: 'w2',
		})
		expect(result.synced).toBe(1)

		const remaining = await payload.find({
			collection: devicesSlug,
			where: { contact: { equals: 'sip:100@desk' } },
			overrideAccess: true,
			depth: 0,
		})
		expect(remaining.totalDocs).toBe(1)
	})
})

describeForDb('syncChannels', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: wildix({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('upserts call groups and prunes orphaned channel docs', async () => {
		const { payload } = booted
		const channelsSlug = 'wildix-channels'
		const usersSlug = 'wildix-users'

		await payload.create({
			collection: channelsSlug,
			data: { wildixId: 'orphan-group', name: 'Orphan Queue' },
			overrideAccess: true,
		})

		const client = buildMockWmsClient({
			callGroups: [
				{
					id: 5,
					title: 'Support Queue',
					members: ['100'],
					settings: {
						strategy: 'ringall',
						timeout: 30,
						maxLen: 10,
						wrapUpTime: 5,
						cid: '',
						queueManager: '',
					},
				},
			],
		})

		const result = await syncChannels({
			payload,
			client,
			wildixChannelsSlug: channelsSlug,
			wildixUsersSlug: usersSlug,
			prune: true,
		})
		expect(result).toMatchObject({ synced: 1, errors: 0, deleted: 1 })

		const remaining = await payload.find({
			collection: channelsSlug,
			overrideAccess: true,
			depth: 0,
		})
		const ids = remaining.docs.map((d) => (d as unknown as Record<string, unknown>).wildixId)
		expect(ids).toContain('5')
		expect(ids).not.toContain('orphan-group')
	})
})
