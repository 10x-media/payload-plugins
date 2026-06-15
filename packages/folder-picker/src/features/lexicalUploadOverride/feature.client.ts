'use client'

import { createClientFeature } from '@payloadcms/richtext-lexical/client'

import type { FolderUploadOverrideClientProps } from './feature.server'

import { FolderUploadPlugin } from './plugin'

export { FolderUploadPlugin }

export const FolderUploadOverrideFeatureClient =
	createClientFeature<FolderUploadOverrideClientProps>({
		plugins: [
			{
				Component: FolderUploadPlugin,
				position: 'normal',
			},
		],
	})
