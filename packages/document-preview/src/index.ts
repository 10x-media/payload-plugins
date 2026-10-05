import { type Config, definePlugin } from 'payload'

import type { DocumentPreviewPluginOptions } from './options'
import { fileIconEndpoint } from './plugin/fileIcons'
import { injectCollections } from './plugin/injectCollections'
import { normalizeOptions } from './plugin/normalizeOptions'
import { registerTranslations } from './plugin/registerTranslations'
import type { DocumentPreviewRegistry } from './plugin/registry'
import { setRegistry } from './plugin/registry'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/document-preview': DocumentPreviewPluginOptions
	}
}

/** Every host viewer path, so `generate:importmap` (which only scans known slots) picks them up. */
const registerViewerDependencies = (config: Config, registry: DocumentPreviewRegistry): void => {
	const paths = new Set([
		...Object.values(registry.viewers),
		...Object.values(registry.collections).flatMap((preview) => Object.values(preview.viewers)),
	])
	if (paths.size === 0) {
		return
	}
	config.admin ??= {}
	config.admin.dependencies ??= {}
	for (const path of paths) {
		config.admin.dependencies[`document-preview:${path}`] = { path, type: 'component' }
	}
}

/**
 * Document Preview plugin for Payload v3: read-only previews of upload
 * documents (images, video, audio, PDF, CSV, text, DOCX, XLSX, PPTX) in the
 * admin, opened from a drawer, inline above the fields, or a list column. Every
 * viewer loads lazily on first open. Authored with `definePlugin` so sibling
 * plugins can detect it by slug.
 */
export const documentPreview = definePlugin<DocumentPreviewPluginOptions>({
	slug: '@10x-media/document-preview',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		const registry = normalizeOptions(config, options)
		setRegistry(config, registry)
		injectCollections(config, registry)
		registerViewerDependencies(config, registry)
		if (Object.values(registry.collections).some((preview) => preview.fileIcons)) {
			config.endpoints = [...(config.endpoints ?? []), fileIconEndpoint]
		}
		config.admin ??= {}
		config.admin.components ??= {}
		config.admin.components.providers = [
			...(config.admin.components.providers ?? []),
			'@10x-media/document-preview/rsc#DocumentPreviewProviderServer',
		]
		return config
	},
})

export type {
	CollectionPreviewOptions,
	DocumentPreviewPluginOptions,
	DocumentPreviewPluginOptions as PluginOptions,
	PreviewDisplay,
	ViewerOverrides,
} from './options'
