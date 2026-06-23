// collections/CallLogs.ts
import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'

export const createCallLogsCollection = (
	contactCollections: CollectionSlug[],
	overrides?: Partial<CollectionConfig>
): CollectionConfig => {
	const defaultCallLogs: CollectionConfig = {
		slug: 'call-logs',
		labels: {
			singular: 'Call Log',
			plural: 'Call Logs',
		},
		admin: {
			useAsTitle: 'callId',
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
				options: ['incoming', 'outgoing'],
			},
			{
				name: 'callStatus',
				type: 'select',
				required: true,
				options: ['ringing', 'connected', 'missed', 'voicemail', 'rejected'],
			},
			{
				name: 'callDuration',
				type: 'number',
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
		],
	}

	if (overrides) {
		return deepMerge(defaultCallLogs, overrides)
	}

	return defaultCallLogs
}
