import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { resolveRelatedContact } from '../utils/resolveRelatedContact'

export const createCallLogsCollection = (
	contactCollections: CollectionSlug[],
	phoneNumberFields: string[],
	overrides?: Partial<CollectionConfig>
): CollectionConfig => {
	const defaultCallLogs: CollectionConfig = {
		slug: 'call-logs',
		labels: {
			singular: labelForKey(keys.callLogsSingular),
			plural: labelForKey(keys.callLogsPlural),
		},
		admin: {
			useAsTitle: 'callId',
		},
		hooks: {
			beforeChange: [
				async ({ data, req }) => {
					if (data.relatedContact) return data
					const phoneNumber = data.fromNumber ?? data.toNumber
					if (!phoneNumber) return data
					const match = await resolveRelatedContact({
						payload: req.payload,
						contactCollections,
						phoneNumberFields,
						phoneNumber,
					})
					if (match) {
						data.relatedContact = match
					}
					return data
				},
			],
		},
		fields: [
			{
				name: 'callId',
				type: 'text',
				required: true,
				unique: true,
			},
			{
				name: 'callType',
				type: 'select',
				required: true,
				options: ['in', 'out'],
			},
			{
				name: 'callStatus',
				type: 'select',
				required: true,
				options: ['ringing', 'connected', 'completed', 'missed', 'voicemail', 'rejected'],
			},
			{
				name: 'callDuration',
				type: 'number',
				defaultValue: 0,
				required: true,
			},
			{
				name: 'fromNumber',
				type: 'text',
				required: true,
			},
			{
				name: 'toNumber',
				type: 'text',
				required: true,
			},
			{
				name: 'relatedContact',
				type: 'relationship',
				relationTo: contactCollections,
				required: false,
			},
			{
				name: 'startedAt',
				type: 'date',
			},
		],
	}

	if (overrides) {
		return deepMerge(defaultCallLogs, overrides)
	}

	return defaultCallLogs
}
