import type { Payload } from 'payload'
import type { SipgateCredentials } from '../types'
import {
	buildSipgateRest,
	getDevices,
	getGroups,
	getUsers,
	type SipgateDevice,
	type SipgateRestFetch,
} from './sipgate.rest'
import { upsertByField } from './upsertByField'

export type SyncResult = { synced: number; errors: number; deleted: number }

type SyncUsersOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateUsersSlug: string
	prune?: boolean
}

export const syncUsers = async ({
	payload,
	rest,
	sipgateUsersSlug,
	prune,
}: SyncUsersOptions): Promise<SyncResult> => {
	const users = await getUsers(rest)
	const seenIds = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const user of users) {
		seenIds.add(user.id)
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

	if (prune) {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
			const orphans = await (payload.find as any)({
				collection: sipgateUsersSlug,
				where: { id: { not_in: [...seenIds] } },
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})
			for (const doc of orphans.docs) {
				try {
					// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
					await (payload.delete as any)({
						collection: sipgateUsersSlug,
						id: doc.id as string,
						overrideAccess: true,
					})
					deleted++
				} catch {
					errors++
				}
			}
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted }
}

type SyncDevicesOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateDevicesSlug: string
	sipgateUsersSlug: string
	prune?: boolean
}

export const syncDevices = async ({
	payload,
	rest,
	sipgateDevicesSlug,
	sipgateUsersSlug,
	prune,
}: SyncDevicesOptions): Promise<SyncResult> => {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
	const usersResult = await (payload.find as any)({
		collection: sipgateUsersSlug,
		limit: 1000,
		depth: 0,
		overrideAccess: true,
	})

	const seen = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

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

	if (prune) {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
			const orphans = await (payload.find as any)({
				collection: sipgateDevicesSlug,
				where: { id: { not_in: [...seen] } },
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})
			for (const doc of orphans.docs) {
				try {
					// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
					await (payload.delete as any)({
						collection: sipgateDevicesSlug,
						id: doc.id as string,
						overrideAccess: true,
					})
					deleted++
				} catch {
					errors++
				}
			}
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted }
}

type SyncChannelsOptions = {
	payload: Payload
	rest: SipgateRestFetch
	sipgateChannelsSlug: string
	sipgateUsersSlug: string
	prune?: boolean
}

export const syncChannels = async ({
	payload,
	rest,
	sipgateChannelsSlug,
	sipgateUsersSlug,
	prune,
}: SyncChannelsOptions): Promise<SyncResult> => {
	const groups = await getGroups(rest)
	const seenIds = new Set<string>()
	let synced = 0
	let errors = 0
	let deleted = 0

	for (const group of groups) {
		seenIds.add(group.id)
		try {
			const assignedUsers = await Promise.all(
				group.users.map(async (u) => {
					// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
					const result = await (payload.find as any)({
						collection: sipgateUsersSlug,
						where: { id: { equals: u.id } },
						limit: 1,
						overrideAccess: true,
					})
					const payloadDoc = result.docs[0]
					return {
						sipgateUserId: u.id,
						user: payloadDoc ? payloadDoc.id : undefined,
						deviceIds: u.deviceIds.map((deviceId: string) => ({ deviceId })),
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
									users: (group.settings.ringingOrder.users ?? []).map((userId: string) => ({
										userId,
									})),
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

	if (prune) {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
			const orphans = await (payload.find as any)({
				collection: sipgateChannelsSlug,
				where: { id: { not_in: [...seenIds] } },
				limit: 1000,
				depth: 0,
				overrideAccess: true,
			})
			for (const doc of orphans.docs) {
				try {
					// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
					await (payload.delete as any)({
						collection: sipgateChannelsSlug,
						id: doc.id as string,
						overrideAccess: true,
					})
					deleted++
				} catch {
					errors++
				}
			}
		} catch {
			errors++
		}
	}

	return { synced, errors, deleted }
}

/**
 * Returns an `onInit` handler that performs a full sync (users → devices → channels)
 * with pruning, removing any Payload records that no longer exist in sipgate.
 *
 * Usage in payload.config.ts:
 * ```ts
 * onInit: async (payload) => {
 *   await createSipgateOnInit(credentials)(payload)
 * }
 * ```
 */
export const createSipgateOnInit =
	(credentials: SipgateCredentials) =>
	async (payload: Payload): Promise<void> => {
		const rest = buildSipgateRest(credentials)
		await syncUsers({ payload, rest, sipgateUsersSlug: 'sipgate-users', prune: true })
		await syncDevices({
			payload,
			rest,
			sipgateDevicesSlug: 'sipgate-devices',
			sipgateUsersSlug: 'sipgate-users',
			prune: true,
		})
		await syncChannels({
			payload,
			rest,
			sipgateChannelsSlug: 'sipgate-channels',
			sipgateUsersSlug: 'sipgate-users',
			prune: true,
		})
	}
