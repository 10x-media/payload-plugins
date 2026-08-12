import type { Block, TextFieldValidation } from 'payload'

import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { VIDEO_EMBED_BLOCK_SLUG } from './constants'
import { parseVideoEmbedUrl } from './videoEmbed'

const validateEmbedUrl: TextFieldValidation = (value, { req }) => {
	if (typeof value === 'string' && parseVideoEmbedUrl(value)) {
		return true
	}
	return asTranslate(req.t)(keys.videoEmbedInvalidUrl)
}

/**
 * External video embed block (YouTube / Vimeo by URL), registered in the wiki
 * editor only when `options.video` is enabled. The URL is validated with the
 * same parser the read renderer uses, so a saved block always embeds.
 */
export const buildVideoEmbedBlock = (): Block => ({
	slug: VIDEO_EMBED_BLOCK_SLUG,
	interfaceName: 'WikiVideoEmbedBlock',
	labels: {
		singular: labelForKey(keys.videoEmbedBlockSingular),
		plural: labelForKey(keys.videoEmbedBlockPlural),
	},
	fields: [
		{
			name: 'url',
			type: 'text',
			label: labelForKey(keys.videoEmbedUrlLabel),
			required: true,
			validate: validateEmbedUrl,
			admin: { description: labelForKey(keys.videoEmbedUrlDescription) },
		},
	],
})
