import { type Config, definePlugin } from 'payload'

import { buildWikiMediaCollection } from './collections/wikiMedia'
import { buildWikiPagesCollection } from './collections/wikiPages'
import type { AdminWikiPluginOptions } from './options'
import { buildWikiAccess } from './plugin/access'
import { registerTranslations } from './plugin/registerTranslations'
import { registerTriggers } from './plugin/registerTriggers'
import { setWikiRegistry } from './plugin/registry'
import { resolveOptions } from './plugin/resolveOptions'
import { walkAndInjectFieldHelp } from './plugin/walker'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/admin-wiki': AdminWikiPluginOptions
	}
}

/**
 * Browser-tab metadata for the two wiki views. Without it Payload titles every
 * custom view `Payload`, which its own `titleSuffix` then renders as
 * `Payload - Payload`.
 *
 * English literals rather than translation keys because Payload resolves view
 * metadata in `generateCustomViewMetadata`, which is handed only the config and
 * the view config: no `t`, and no route params either, which is why a guide page
 * cannot be titled after the guide it shows. Both shipped locales spell this
 * word the same, and the config's own `admin.meta.titleSuffix` still applies.
 */
const WIKI_INDEX_META = {
	description: 'Guides for working in this admin panel.',
	title: 'Wiki',
}

const WIKI_PAGE_META = {
	description: 'A guide from the admin wiki.',
	title: 'Wiki guide',
}

/**
 * Admin Wiki plugin for Payload v3: a living wiki inside the admin panel.
 * Registers the wiki collections (guide pages + media), the plugin registry,
 * and translations. Must run after any plugin that adds collections or fields,
 * so guides can target them. Authored with `definePlugin` so sibling plugins
 * can detect it by slug.
 */
export const adminWiki = definePlugin<AdminWikiPluginOptions>({
	slug: '@10x-media/admin-wiki',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		const resolved = resolveOptions(options)
		const walk = walkAndInjectFieldHelp(config, resolved)
		setWikiRegistry(config, {
			...resolved,
			blockLabels: walk.blockLabels,
			validTargetKeys: walk.validTargetKeys,
		})
		const warnings = [...walk.warnings]
		if (walk.injectedFieldCount === 0) {
			warnings.push(
				'@10x-media/admin-wiki: the config walker found no fields to attach help to. ' +
					'Register adminWiki() after any plugin that adds collections or fields.'
			)
		}
		if (warnings.length > 0) {
			const priorOnInit = config.onInit
			config.onInit = async (payload) => {
				for (const warning of warnings) {
					payload.logger.warn(warning)
				}
				await priorOnInit?.(payload)
			}
		}
		registerTriggers(config, resolved)
		const access = buildWikiAccess(options.access)
		config.collections = [
			...(config.collections ?? []),
			buildWikiPagesCollection({
				access,
				blockSlugs: walk.blockSlugs,
				config,
				hidden: options.hidden?.pages,
				override: options.overrides?.pages,
				resolved,
			}),
			buildWikiMediaCollection({
				access,
				config,
				hidden: options.hidden?.media,
				override: options.overrides?.media,
				resolved,
			}),
		]
		config.admin ??= {}
		config.admin.components ??= {}
		config.admin.components.providers = [
			...(config.admin.components.providers ?? []),
			'@10x-media/admin-wiki/rsc#WikiProviderServer',
		]
		const consumerComponents = [
			...resolved.editorBlocks.map((option) => option.component),
			...(resolved.video !== false && resolved.video.playerComponent
				? [resolved.video.playerComponent]
				: []),
		]
		if (consumerComponents.length > 0) {
			config.admin.dependencies = {
				...config.admin.dependencies,
				...Object.fromEntries(
					consumerComponents.map((component) => [
						`admin-wiki:${component}`,
						{ path: component, type: 'component' as const },
					])
				),
			}
		}
		if (resolved.wikiView) {
			config.admin.components.views = {
				...(config.admin.components.views ?? {}),
				adminWikiIndex: {
					Component: '@10x-media/admin-wiki/rsc#WikiIndexView',
					exact: true,
					meta: WIKI_INDEX_META,
					path: '/wiki',
				},
				adminWikiPage: {
					Component: '@10x-media/admin-wiki/rsc#WikiPageView',
					exact: true,
					meta: WIKI_PAGE_META,
					path: '/wiki/:slug',
				},
			}
		}
		return config
	},
})

export { SUMMARY_MAX_LENGTH } from './collections/wikiPages'
export type {
	AdminWikiPluginOptions,
	AdminWikiPluginOptions as PluginOptions,
	WikiAccessOptions,
	WikiCollectionOverride,
	WikiEditorBlockOption,
	WikiEditorOptions,
	WikiExcludeOptions,
	WikiHiddenOptions,
	WikiListBandOptions,
	WikiListBandSlot,
	WikiOverridesOptions,
	WikiPagesOverride,
	WikiSlugsOptions,
	WikiTriggersOptions,
	WikiVideoOptions,
	WikiWriteAffordanceMode,
} from './options'
export { PAYLOAD_INTERNAL_COLLECTIONS, PAYLOAD_INTERNAL_GLOBALS } from './plugin/exclude'
export { WIKI_GUIDES_FIELD } from './plugin/registerTriggers'
export { getWikiRegistry } from './plugin/registry'
export { WIKI_BLOCK_HELP_FIELD } from './plugin/walker'
export { seedWiki } from './seed/seedWiki'
export { githubAlertsTransformer } from './seed/transformers/githubAlerts'
export { guideLinksTransformer } from './seed/transformers/guideLinks'
export { mediaPlaceholdersTransformer } from './seed/transformers/mediaPlaceholders'
export type {
	WikiSeedContent,
	WikiSeedContext,
	WikiSeedGuideDef,
	WikiSeedLocalized,
	WikiSeedMediaDef,
	WikiSeedOptions,
	WikiSeedResult,
	WikiSeedTargets,
	WikiSeedTransformer,
} from './seed/types'
