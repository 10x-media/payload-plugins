import type { CollectionConfig, Config } from 'payload'

import type { HiddenOption, WikiAccessOptions } from '../options'
import type { ResolvedWikiOptions } from '../plugin/resolveOptions'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export type BuildWikiMediaArgs = {
	access: Required<WikiAccessOptions>
	config: Config
	hidden: HiddenOption | undefined
	resolved: ResolvedWikiOptions
}

/**
 * The wiki's own upload collection, used only by wiki content. Images always;
 * video mimetypes only when the video option is enabled.
 */
export const buildWikiMediaCollection = ({
	access,
	config,
	hidden,
	resolved,
}: BuildWikiMediaArgs): CollectionConfig => {
	const localize = Boolean(config.localization)
	return {
		slug: resolved.slugs.media,
		labels: {
			singular: labelForKey(keys.collectionMediaSingular),
			plural: labelForKey(keys.collectionMediaPlural),
		},
		access,
		admin: {
			...(hidden !== undefined ? { hidden } : {}),
		},
		upload: {
			mimeTypes: resolved.video ? ['image/*', 'video/*'] : ['image/*'],
		},
		fields: [
			{
				name: 'alt',
				type: 'text',
				label: labelForKey(keys.fieldAltLabel),
				...(localize ? { localized: true } : {}),
			},
		],
	}
}
