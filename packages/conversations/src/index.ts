import { type Config, definePlugin } from 'payload'

import { buildMessagesCollection } from './collections/messages'
import { buildReadsCollection } from './collections/reads'
import { buildEndpoints } from './endpoints'
import { registerTranslations } from './plugin/registerTranslations'
import { resolveInstance, runAfterPhases, runBeforePhases } from './plugin/resolveOptions'
import { cascadeHook } from './server/cascade'
import type { InstanceRegistry } from './server/service'
import type { ConversationsPluginOptions } from './types'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/conversations': ConversationsPluginOptions
	}
}

/**
 * A conversations core for Payload: messages bound to targets, with channels,
 * one-level threads, mentions and read state. Call it once per use case; each
 * call is an instance named by `slug` with its own collections and endpoints.
 * Extensions (such as `comments()`) shape an instance before and after it is
 * resolved.
 */
export const conversations = definePlugin<ConversationsPluginOptions>({
	slug: '@10x-media/conversations',
	plugin: ({ config: incoming, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return incoming
		}
		let config = incoming
		registerTranslations(config, options.translations)

		const { extensionMap, options: resolved } = runBeforePhases(options)
		const instance = resolveInstance(config, resolved, extensionMap)

		config.custom ??= {}
		const custom = config.custom as { conversations?: InstanceRegistry }
		custom.conversations ??= { instances: {} }
		const registry = custom.conversations
		if (registry.instances[instance.slug]) {
			throw new Error(`[@10x-media/conversations] two instances share the slug "${instance.slug}"`)
		}
		registry.instances[instance.slug] = instance

		config.collections = [
			...(config.collections ?? []),
			buildMessagesCollection(instance),
			...(instance.readsSlug ? [buildReadsCollection(instance, instance.readsSlug)] : []),
		]
		config.endpoints = [...(config.endpoints ?? []), ...buildEndpoints(instance)]
		config.admin ??= {}
		config.admin.components ??= {}
		config.admin.components.providers = [
			...(config.admin.components.providers ?? []),
			{
				clientProps: { instance: instance.slug },
				path: '@10x-media/conversations/client#ChatAdminProvider',
			},
		]

		const targetCollections = Object.keys(instance.targets.collections)
		config.collections = config.collections.map((collection) => {
			if (!targetCollections.includes(collection.slug)) {
				return collection
			}
			return {
				...collection,
				hooks: {
					...collection.hooks,
					afterDelete: [
						...(collection.hooks?.afterDelete ?? []),
						cascadeHook(instance, collection.slug),
					],
				},
			}
		})
		const missing = targetCollections.filter(
			(slug) => !config.collections?.some((collection) => collection.slug === slug)
		)
		if (missing.length > 0) {
			throw new Error(
				`[@10x-media/conversations] instance "${instance.slug}" targets unknown collections: ${missing.join(', ')}`
			)
		}

		config = runAfterPhases(config, instance, resolved.extensions ?? [])
		return config
	},
})

export { defineExtension, defineMessageType, type PerTargetCheck, perTarget } from './server/define'
export {
	getInstance,
	type PostMessageArgs,
	postMessage,
	touchMessage,
} from './server/service'
export {
	collectionKey,
	customKey,
	globalKey,
	parseKey,
	parseUserKey,
	userKey,
} from './shared/keys'
export type * from './types'
export type { ConversationsPluginOptions as PluginOptions } from './types'
