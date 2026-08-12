import type { CollectionConfig, Config } from 'payload'

import type { HiddenOption, WikiAccessOptions, WikiCollectionOverride } from '../options'
import type { ResolvedWikiOptions } from '../plugin/resolveOptions'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export type BuildWikiMediaArgs = {
	access: Required<WikiAccessOptions>
	config: Config
	hidden: HiddenOption | undefined
	override: undefined | WikiCollectionOverride
	resolved: ResolvedWikiOptions
}

/**
 * The wiki's own upload collection, used only by wiki content. Images always;
 * video mimetypes only when the video option is enabled.
 *
 * There is no tab shorthand here, unlike the guide pages: an upload collection
 * is one alt field and a file, so a function is the whole surface it needs.
 */
export const buildWikiMediaCollection = ({
	access,
	config,
	hidden,
	override,
	resolved,
}: BuildWikiMediaArgs): CollectionConfig => {
	const localize = Boolean(config.localization)
	const collection: CollectionConfig = {
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

	return override ? override(collection) : collection
}
