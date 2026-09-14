import { type CollectionSlug, type Config, definePlugin } from 'payload'

import { buildEvaluateEndpoint } from './plugin/endpoint'
import { collectDependencies, withVariantView } from './plugin/registerComponents'
import { registerTranslations } from './plugin/registerTranslations'
import { setRegistry } from './plugin/registry'
import { collectConfigs, readCollectionConfig } from './plugin/resolveConfig'
import { validateCollectionConfig } from './plugin/validate'
import type { TranslationsOption } from './translations'
import type { FormVariantsCollections, FormVariantsConfig, SlotComponents } from './types'

export type FormVariantsPluginOptions = {
	/**
	 * Variants for collections the consumer does not own. A collection owned by the consumer
	 * is configured on the collection itself, under `custom.formVariants`, with
	 * `defineFormVariants`. The same slug in both places fails at config time.
	 */
	collections?: FormVariantsCollections
	/** Chrome replacements for every configured collection. */
	components?: SlotComponents
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/form-variants/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/form-variants': FormVariantsPluginOptions
	}
}

/**
 * Types a collection's variants against its generated document type:
 * `defineFormVariants('people', { ... })`. `custom` carries no slug, so it is given here, and
 * the plugin fails at config time when it does not match the collection the config sits on.
 */
export const defineFormVariants = <TSlug extends CollectionSlug>(
	slug: TSlug,
	config: NoInfer<Omit<FormVariantsConfig<TSlug>, 'slug'>>
): FormVariantsConfig<TSlug> => ({ ...config, slug })

/**
 * Replaces a collection's edit view with one of several variants of the same form: sequences
 * of steps drawn over Payload's own form state, rendered with Payload's own fields, saved by
 * Payload's own save. `native` (Payload's default edit view) is one of the variants.
 *
 * Step logic and access stay on the server: the resolved config is parked under
 * `config.custom`, which Payload never sends to the browser, and later evaluations go through
 * the plugin's own endpoint. The plugin stores nothing of its own.
 */
export const formVariants = definePlugin<FormVariantsPluginOptions>({
	slug: '@10x-media/form-variants',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}

		const collections = config.collections ?? []

		for (const collection of collections) {
			const own = readCollectionConfig(collection)
			if (own) {
				validateCollectionConfig(collection, own)
			}
		}
		for (const [slug, fromOptions] of Object.entries(options.collections ?? {})) {
			const collection = collections.find((candidate) => candidate.slug === slug)
			if (collection && fromOptions) {
				validateCollectionConfig(collection, fromOptions as FormVariantsConfig)
			}
		}

		const resolved = collectConfigs(collections, options.collections)

		const next: Config = {
			...config,
			admin: {
				...config.admin,
				dependencies: {
					...config.admin?.dependencies,
					...collectDependencies(resolved, options.components),
				},
			},
			collections: collections.map((collection) =>
				resolved[collection.slug] ? withVariantView(collection) : collection
			),
			custom: { ...config.custom },
			endpoints: [...(config.endpoints ?? []), buildEvaluateEndpoint()],
		}

		setRegistry(next, { collections: resolved, components: options.components })
		registerTranslations(next, options.translations)

		return next
	},
})

export {
	COLLECTION_CUSTOM_KEY,
	EVALUATE_PATH,
	NATIVE_KEY,
	preferenceKeyFor,
	STEP_PARAM,
	VARIANT_PARAM,
} from './plugin/constants'
export {
	type FormVariantsRegistry,
	getCollectionVariants,
	getRegistry,
	type ResolvedCollection,
	type ResolvedStep,
	type ResolvedVariant,
} from './plugin/registry'
export * from './types'
export type { FormVariantsPluginOptions as PluginOptions }
