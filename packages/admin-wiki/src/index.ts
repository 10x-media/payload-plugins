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
		if (walk.injectedFieldCount === 0) {
			const priorOnInit = config.onInit
			config.onInit = async (payload) => {
				payload.logger.warn(
					'@10x-media/admin-wiki: the config walker found no fields to attach help to. ' +
						'Register adminWiki() after any plugin that adds collections or fields.'
				)
				await priorOnInit?.(payload)
			}
		}
		registerTriggers(config, resolved)
		const access = buildWikiAccess(options.access)
		config.collections = [
			...(config.collections ?? []),
			buildWikiPagesCollection({ access, config, hidden: options.hidden?.pages, resolved }),
			buildWikiMediaCollection({ access, config, hidden: options.hidden?.media, resolved }),
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
					path: '/wiki',
				},
				adminWikiPage: {
					Component: '@10x-media/admin-wiki/rsc#WikiPageView',
					exact: true,
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
	WikiEditorBlockOption,
	WikiEditorOptions,
	WikiHiddenOptions,
	WikiListBandOptions,
	WikiListBandSlot,
	WikiSlugsOptions,
	WikiTriggersOptions,
	WikiVideoOptions,
	WikiWriteAffordanceMode,
} from './options'
export { WIKI_GUIDES_FIELD } from './plugin/registerTriggers'
export { getWikiRegistry } from './plugin/registry'
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
