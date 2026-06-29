import type { Payload } from 'payload'
import {
	getDevices,
	getGroups,
	getUsers,
	type SipgateDevice,
	type SipgateRestFetch,
} from './sipgate.rest'
import { upsertByField } from './upsertByField'

export type SyncResult = { synced: number; errors: number }

type SyncUsersOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateUsersSlug: string
}

export const syncUsers = async ({
	payload,
	rest,
	sipgateUsersSlug,
}: SyncUsersOptions): Promise<SyncResult> => {
	const users = await getUsers(rest)
	let synced = 0
	let errors = 0

	for (const user of users) {
		try {
			await upsertByField({
				payload,
				collection: sipgateUsersSlug,
				uniqueField: 'id',
				uniqueValue: user.id,
				data: {
					id: user.id,
					firstname: user.firstname,
					lastname: user.lastname,
					email: user.email,
					defaultDevice: user.defaultDevice,
					admin: user.admin,
					busyOnBusy: user.busyOnBusy,
					timezone: user.timezone,
					addressId: user.addressId,
				},
			})
			synced++
		} catch {
			errors++
		}
	}

	return { synced, errors }
}

type SyncDevicesOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateDevicesSlug: string
	sipgateUsersSlug: string
}

export const syncDevices = async ({
	payload,
	rest,
	sipgateDevicesSlug,
	sipgateUsersSlug,
}: SyncDevicesOptions): Promise<SyncResult> => {
	const usersResult = await payload.find({
		collection: sipgateUsersSlug,
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	const seen = new Set<string>()
	let synced = 0
	let errors = 0

	for (const user of usersResult.docs) {
		const userId = user.id as string
		let userDevices: SipgateDevice[]
		try {
			userDevices = await getDevices(rest, userId)
		} catch {
			errors++
			continue
		}

		for (const device of userDevices) {
			if (seen.has(device.id)) continue
			seen.add(device.id)
			try {
				await upsertByField({
					payload,
					collection: sipgateDevicesSlug,
					uniqueField: 'id',
					uniqueValue: device.id,
					data: {
						id: device.id,
						alias: device.alias,
						type: device.type,
						online: device.online,
						dnd: device.dnd,
						activeGroups: device.activeGroups ?? [],
						activePhonelines: device.activePhonelines ?? [],
						sipgateUserId: userId,
						sipgateUser: userId,
					},
				})
				synced++
			} catch {
				errors++
			}
		}
	}

	return { synced, errors }
}

type SyncChannelsOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateChannelsSlug: string
	sipgateUsersSlug: string
}

export const syncChannels = async ({
	payload,
	rest,
	sipgateChannelsSlug,
	sipgateUsersSlug,
}: SyncChannelsOptions): Promise<SyncResult> => {
	const groups = await getGroups(rest)
	let synced = 0
	let errors = 0

	for (const group of groups) {
		try {
			const assignedUsers = await Promise.all(
				group.users.map(async (u) => {
					const result = await payload.find({
						collection: sipgateUsersSlug,
						where: { id: { equals: u.id } },
						limit: 1,
						overrideAccess: true,
					})
					const payloadDoc = result.docs[0]
					return {
						sipgateUserId: u.id,
						user: payloadDoc ? payloadDoc.id : undefined,
						deviceIds: u.deviceIds.map((deviceId) => ({ deviceId })),
					}
				})
			)

			await upsertByField({
				payload,
				collection: sipgateChannelsSlug,
				uniqueField: 'id',
				uniqueValue: group.id,
				data: {
					id: group.id,
					name: group.name,
					owner: group.owner,
					createdAt: group.createdAt ? new Date(group.createdAt) : undefined,
					locale: group.locale,
					assignedUsers,
					settings: {
						greetingAudioFileId: group.settings.greetingAudioFileId,
						smsSim: group.settings.smsSim,
						voiceboxAccessNumber: group.settings.voiceboxAccessNumber,
						queue: group.settings.queue
							? {
									respectWaitingTime: group.settings.queue.respectWaitingTime,
									waitingAudioFileId: group.settings.queue.waitingAudioFileId,
								}
							: undefined,
						ringingOrder: group.settings.ringingOrder
							? {
									type: group.settings.ringingOrder.type,
									users: (group.settings.ringingOrder.users ?? []).map((userId) => ({ userId })),
								}
							: undefined,
						userDefaults: group.settings.users
							? {
									followUpTime: group.settings.users.followUpTime,
									ringTime: group.settings.users.ringTime,
								}
							: undefined,
					},
				},
			})

			const isPersonalChannel = group.users.length === 1 && group.users[0]?.id === group.owner
			if (isPersonalChannel) {
				await upsertByField({
					payload,
					collection: sipgateUsersSlug,
					uniqueField: 'id',
					uniqueValue: group.owner,
					data: { defaultChannel: group.id },
				})
			}

			synced++
		} catch {
			errors++
		}
	}

	return { synced, errors }
}
