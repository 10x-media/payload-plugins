import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { authenticatedCollectionAccess } from '../utils/access'
import { resolveRelatedContact } from '../utils/resolveRelatedContact'

type CreateCallLogsCollectionOptions = {
	contactCollections: CollectionSlug[]
	phoneNumberFields: string[]
	overrides?: Partial<CollectionConfig>
	enableSyncButton?: boolean
}

export const createCallLogsCollection = ({
	contactCollections,
	phoneNumberFields,
	overrides,
	enableSyncButton,
}: CreateCallLogsCollectionOptions): CollectionConfig => {
	const defaultCallLogs: CollectionConfig = {
		slug: 'call-logs',
		access: authenticatedCollectionAccess,
		labels: {
			singular: labelForKey(keys.callLogsSingular),
			plural: labelForKey(keys.callLogsPlural),
		},
		admin: {
			useAsTitle: 'callId',
			...(enableSyncButton
				? {
						components: {
							listMenuItems: ['@10x-media/wildix/ui/WildixSyncButton#WildixCallLogsSyncButton'],
						},
					}
				: {}),
		},
		hooks: {
			beforeChange: [
				async ({ data, req }) => {
					if (data.relatedContact) return data
					const phoneNumber =
						data.callType === 'out' ? data.toNumber : (data.fromNumber ?? data.toNumber)
					if (!phoneNumber) return data
					try {
						const match = await resolveRelatedContact({
							payload: req.payload,
							contactCollections,
							phoneNumberFields,
							phoneNumber,
						})
						if (match) {
							data.relatedContact = match
						}
					} catch {
						// Contact match must never block call-log persistence.
					}
					return data
				},
			],
		},
		fields: [
			{ name: 'callId', type: 'text', required: true, unique: true },
			{
				name: 'wildixUserId',
				type: 'text',
				admin: {
					description: 'Wildix PBX user id that owns this call log. Set in OAuth2 mode.',
					position: 'sidebar',
				},
			},
			{ name: 'callType', type: 'select', required: true, options: ['in', 'out'] },
			{
				name: 'callStatus',
				type: 'select',
				required: true,
				options: ['ringing', 'connected', 'completed', 'missed', 'voicemail', 'rejected'],
			},
			{ name: 'callDuration', type: 'number', defaultValue: 0, required: true },
			{ name: 'fromNumber', type: 'text', required: true },
			{ name: 'toNumber', type: 'text', required: true },
			...(contactCollections.length > 0
				? [
						{
							name: 'relatedContact',
							type: 'relationship' as const,
							relationTo: contactCollections,
							required: false,
						},
					]
				: []),
			{ name: 'startedAt', type: 'date' },
		],
	}

	if (overrides) {
		return deepMerge(defaultCallLogs, overrides)
	}

	return defaultCallLogs
}
