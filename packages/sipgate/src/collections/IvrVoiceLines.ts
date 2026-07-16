import type { Access, CollectionConfig } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const authenticated: Access = ({ req }) => Boolean(req.user)

export const createIvrVoiceLinesCollection = (
	slug: string,
	overrides?: Partial<CollectionConfig>
): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		labels: {
			singular: labelForKey(keys.ivrVoiceLinesSingular),
			plural: labelForKey(keys.ivrVoiceLinesPlural),
		},
		upload: {
			mimeTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg'],
		},
		// Read is public so sipgate's servers can fetch the audio URLs during IVR playback.
		access: {
			read: () => true,
			create: authenticated,
			update: authenticated,
			delete: authenticated,
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
	}

	return overrides ? deepMerge(defaults, overrides) : defaults
}
