import type { CollectionConfig } from 'payload'

export const createIvrVoiceLinesCollection = (slug: string): CollectionConfig => ({
	slug,
	labels: {
		singular: 'IVR Voice Line',
		plural: 'IVR Voice Lines',
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
		},
	],
})
