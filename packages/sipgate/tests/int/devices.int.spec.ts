import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createSipgateDevices } from '../../src/endpoints/sipgate.devices'
import { sipgate } from '../../src/index'

describeForDb('devices endpoint — user not linked', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: sipgate({}),
			db,
			collections: [{ slug: 'users', auth: true, fields: [] }],
		})

		await booted.payload.create({
			collection: 'sipgate-devices',
			data: { sipgateId: 'e0', alias: 'Office Phone', sipgateUserId: 'w0' },
			overrideAccess: true,
		})
		await booted.payload.create({
			collection: 'sipgate-devices',
			data: { sipgateId: 'e1', alias: 'Mobile', sipgateUserId: 'w1' },
			overrideAccess: true,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('returns empty array when the logged-in user has no sipgate account linked', async () => {
		const endpoint = createSipgateDevices({
			sipgateDevicesSlug: 'sipgate-devices',
			sipgateUsersSlug: 'sipgate-users',
			filterDevicesByUser: true,
		})

		const req = {
			payload: booted.payload,
			user: { id: 'payload-user-with-no-sipgate-link' },
			url: 'http://localhost/api/sipgate/devices',
		}

		const response = await (endpoint.handler as (r: unknown) => Promise<Response>)(req)
		const body = (await response.json()) as unknown[]

		expect(Array.isArray(body)).toBe(true)
		expect(body).toHaveLength(0)
	})

	it('returns only the devices belonging to the linked user', async () => {
		const { payload } = booted

		const payloadUser = await payload.create({
			collection: 'users',
			data: { email: 'w0linked@test.com', password: 'secret' },
			overrideAccess: true,
		})

		await payload.create({
			collection: 'sipgate-users',
			data: {
				sipgateId: 'w0',
				email: 'w0@test.com',
				payloadUser: { relationTo: 'users', value: payloadUser.id },
			},
			overrideAccess: true,
		})

		const endpoint = createSipgateDevices({
			sipgateDevicesSlug: 'sipgate-devices',
			sipgateUsersSlug: 'sipgate-users',
			filterDevicesByUser: true,
		})

		const req = {
			payload,
			user: { id: payloadUser.id },
			url: 'http://localhost/api/sipgate/devices',
		}

		const response = await (endpoint.handler as (r: unknown) => Promise<Response>)(req)
		const body = (await response.json()) as Array<Record<string, unknown>>

		expect(body.map((d) => d.sipgateId)).toEqual(['e0'])
	})
})
