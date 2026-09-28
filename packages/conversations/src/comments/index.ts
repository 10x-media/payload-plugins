import type { CollectionConfig, Config, GlobalConfig } from 'payload'

import type { ConversationsExtension, ConversationsPluginOptions } from '../types'

/** `true`: every channel of the instance. A list: only those. */
export type CommentsTargetChannels = string[] | true

export type CommentsOptions = {
	collections?: Record<string, CommentsTargetChannels>
	globals?: Record<string, CommentsTargetChannels>
}

const TRIGGER_PATH = '@10x-media/conversations/client#ChatTrigger'

const resolveChannels = (
	options: ConversationsPluginOptions,
	value: CommentsTargetChannels
): { channels: string[] } => ({
	channels: value === true ? options.channels.map((channel) => channel.slug) : [...value],
})

const trigger = (instance: string) => ({ clientProps: { instance }, path: TRIGGER_PATH })

/**
 * Comments on documents: a button in the document controls of each listed
 * collection and global, opening the conversation drawer. Pure composition
 * over the core: `before` adds the targets, `after` adds the button. No
 * components of its own.
 *
 * The button hides on create views (no id yet). Drafts and the published
 * version share one conversation; comments are not localized and Duplicate
 * does not copy them.
 */
export const comments = (options: CommentsOptions): ConversationsExtension => ({
	after: ({ config, instance }): Config => {
		const collections = Object.keys(options.collections ?? {})
		const globals = Object.keys(options.globals ?? {})
		return {
			...config,
			collections: (config.collections ?? []).map(
				(collection): CollectionConfig =>
					collections.includes(collection.slug)
						? {
								...collection,
								admin: {
									...collection.admin,
									components: {
										...collection.admin?.components,
										edit: {
											...collection.admin?.components?.edit,
											beforeDocumentControls: [
												...(collection.admin?.components?.edit?.beforeDocumentControls ?? []),
												trigger(instance.slug),
											],
										},
									},
								},
							}
						: collection
			),
			globals: (config.globals ?? []).map(
				(global): GlobalConfig =>
					globals.includes(global.slug)
						? {
								...global,
								admin: {
									...global.admin,
									components: {
										...global.admin?.components,
										elements: {
											...global.admin?.components?.elements,
											beforeDocumentControls: [
												...(global.admin?.components?.elements?.beforeDocumentControls ?? []),
												trigger(instance.slug),
											],
										},
									},
								},
							}
						: global
			),
		}
	},
	before: (current) => ({
		...current,
		targets: {
			...current.targets,
			collections: {
				...current.targets?.collections,
				...Object.fromEntries(
					Object.entries(options.collections ?? {}).map(([slug, value]) => [
						slug,
						resolveChannels(current, value),
					])
				),
			},
			globals: {
				...current.targets?.globals,
				...Object.fromEntries(
					Object.entries(options.globals ?? {}).map(([slug, value]) => [
						slug,
						resolveChannels(current, value),
					])
				),
			},
		},
	}),
	name: 'comments',
	options,
})
