import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PbxCallGroup, PbxColleague, WmsApiClient } from '@wildix/wms-api-client'
import { GetPbxCallGroupsCommand, GetPbxColleaguesCommand } from '@wildix/wms-api-client'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { wildix } from '../../src/index'
import type { WildixCredentials } from '../../src/types'
import type { PbxDeviceRecord, PbxSipRegistrationsByExtension } from '../../src/utils/wildixPbxRest'
import { syncChannels, syncDevices, syncUsers } from '../../src/utils/wildixSyncHandlers'

type MockFixtures = {
	colleagues?: Partial<PbxColleague>[]
	callGroups?: Partial<PbxCallGroup>[]
}

/** Duck-types a WmsApiClient by pattern-matching on the command class sent to it. */
const buildMockWmsClient = ({ colleagues = [], callGroups = [] }: MockFixtures): WmsApiClient => {
	const send = async (command: unknown) => {
		if (command instanceof GetPbxColleaguesCommand) {
			return { type: 'result', result: { records: colleagues, total: colleagues.length } }
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

const testCredentials: WildixCredentials = {
	authType: 'apiKey',
	apiKey: 'test-key',
	pbxHost: 'pbx.test',
}

type MockDevicesFetchOptions = {
	hardware?: PbxDeviceRecord[]
	sip?: PbxSipRegistrationsByExtension
}

/** Stubs Devices + SIP Registrations endpoints based on the request URL. */
const mockDevicesFetch = ({ hardware = [], sip = {} }: MockDevicesFetchOptions) =>
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input)
		const body = url.includes('/Sip/Registrations')
			? { type: 'result', result: sip }
			: { type: 'result', result: { records: hardware } }
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	})

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

	afterEach(() => {
		vi.restoreAllMocks()
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('upserts the device inventory keyed by wildixId, links users by extension, and prunes orphans', async () => {
		const { payload } = booted
		const usersSlug = 'wildix-users'
		const devicesSlug = 'wildix-devices'

		const user = await payload.create({
			collection: usersSlug,
			data: { wildixId: 'w0', email: 'w0@test.com', extension: '100' },
			overrideAccess: true,
		})
		await payload.create({
			collection: devicesSlug,
			data: { wildixId: 'orphan-99', contact: 'orphan-mac', userAgent: 'Old Phone', online: false },
			overrideAccess: true,
		})

		mockDevicesFetch({
			hardware: [
				{ id: 1, mac: 'aa1100', model: 'Yealink T54W', user: '100', state: 'on' },
				{ id: 2, mac: 'bb2200', model: 'x-bees Mobile', user: '100', state: 'off' },
			],
		})

		const result = await syncDevices({
			payload,
			credentials: testCredentials,
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
		const byWildixId = new Map(
			remaining.docs.map((d) => {
				const doc = d as unknown as Record<string, unknown>
				return [doc.wildixId as string, doc]
			})
		)

		expect(byWildixId.has('orphan-99')).toBe(false)
		expect(byWildixId.get('1')).toMatchObject({
			contact: 'aa1100',
			online: true,
			isActiveDevice: true,
			wildixUserId: 'w0',
			wildixUser: user.id,
		})
		expect(byWildixId.get('2')).toMatchObject({ online: false, isActiveDevice: false })
	})

	it('merges SIP softphone registrations with hardware inventory', async () => {
		const { payload } = booted
		const usersSlug = 'wildix-users'
		const devicesSlug = 'wildix-devices'

		await payload.create({
			collection: usersSlug,
			data: { wildixId: 'w-soft', email: 'soft@test.com', extension: '204' },
			overrideAccess: true,
		})

		mockDevicesFetch({
			hardware: [{ id: 9, mac: 'hwmac', model: 'Desk', user: '204', state: 'on' }],
			sip: {
				'204': {
					registrations: [
						{
							online: '1',
							contact: 'sip:204@1.2.3.4:5060;transport=ws',
							instance: '<urn:uuid:abc>',
							useragent: 'Wildix Zero Distance',
						},
					],
				},
			},
		})

		const result = await syncDevices({
			payload,
			credentials: testCredentials,
			wildixDevicesSlug: devicesSlug,
			wildixUsersSlug: usersSlug,
			prune: false,
		})
		expect(result.synced).toBeGreaterThanOrEqual(2)

		const soft = await payload.find({
			collection: devicesSlug,
			where: { wildixId: { equals: 'sip:204:urn:uuid:abc' } },
			overrideAccess: true,
			depth: 0,
		})
		expect(soft.totalDocs).toBe(1)
		expect(soft.docs[0]).toMatchObject({
			contact: 'sip:204@1.2.3.4:5060;transport=ws',
			userAgent: 'Wildix Zero Distance',
			online: true,
			wildixUserId: 'w-soft',
		})
	})

	it('skips prune and only syncs the scoped user’s devices when scopeToUserId is set', async () => {
		const { payload } = booted
		const usersSlug = 'wildix-users'
		const devicesSlug = 'wildix-devices'

		await payload.create({
			collection: usersSlug,
			data: { wildixId: 'w2', email: 'w2@test.com', extension: '102' },
			overrideAccess: true,
		})

		mockDevicesFetch({
			hardware: [
				{ id: 10, mac: 'ext100mac', user: '100', state: 'on' },
				{ id: 11, mac: 'ext102mac', user: '102', state: 'on' },
			],
		})

		const result = await syncDevices({
			payload,
			credentials: testCredentials,
			wildixDevicesSlug: devicesSlug,
			wildixUsersSlug: usersSlug,
			prune: true,
			scopeToUserId: 'w2',
		})
		expect(result.synced).toBe(1)

		const scoped = await payload.find({
			collection: devicesSlug,
			where: { wildixId: { equals: '11' } },
			overrideAccess: true,
			depth: 0,
		})
		expect(scoped.totalDocs).toBe(1)

		const unscoped = await payload.find({
			collection: devicesSlug,
			where: { wildixId: { equals: '10' } },
			overrideAccess: true,
			depth: 0,
		})
		expect(unscoped.totalDocs).toBe(0)
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
