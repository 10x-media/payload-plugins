import type { CollectionConfig } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export const createIvrVoiceLinesCollection = (slug: string): CollectionConfig => ({
	slug,
	labels: {
		singular: labelForKey(keys.ivrVoiceLinesSingular),
		plural: labelForKey(keys.ivrVoiceLinesPlural),
	},
	upload: {
		mimeTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg'],
	},
	access: {
		read: () => true,
	},
	admin: {
		useAsTitle: 'title',
	},
	fields: [
		{
			name: 'title',
			type: 'text',
			required: true,
			label: labelForKey(keys.ivrVoiceLinesFieldTitle),
		},
	],
})
