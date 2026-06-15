import { type Config, definePlugin } from 'payload'
import type { FolderPickerOptions } from './options'
import { registerTranslations } from './plugin/registerTranslations'
import { patchUploadFields } from './utilities/patchUploadFields'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/folder-picker': FolderPickerOptions
	}
}

/**
 * Folder Picker plugin for Payload v3.
 * Runs last (`order: 100`) so it can patch the upload fields of all other plugins.
 */
export const folderPicker = definePlugin<FolderPickerOptions>({
	slug: '@10x-media/folder-picker',
	order: 100,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		if (!config.folders || !config.collections) {
			return config
		}

		registerTranslations(config)

		const folderEnabledSlugs = new Set(
			config.collections.filter((c) => c.folders).map((c) => c.slug)
		)

		if (folderEnabledSlugs.size === 0) {
			return config
		}

		return {
			...config,
			collections: config.collections.map((collection) => ({
				...collection,
				fields: patchUploadFields(collection.fields, { folderEnabledSlugs }),
			})),
			blocks: config?.blocks?.map((block) => {
				if (block.custom?.disableFolderPicker) {
					return block
				}
				return {
					...block,
					fields: patchUploadFields(block.fields, { folderEnabledSlugs }),
				}
			}),
		}
	},
})
export { FolderUploadOverrideFeature } from './features/lexicalUploadOverride/feature.server'
export type { FolderPickerOptions as PluginOptions }
