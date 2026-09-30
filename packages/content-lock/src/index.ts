import { type Config, definePlugin, type Plugin } from 'payload'

import { buildLockCollection } from './collection/lockCollection'
import { CONTENT_LOCKED_ERROR_NAME } from './enforcement/ContentLockedError'
import { isMarkedExempt, registerEnforcement } from './enforcement/register'
import { registerJobsIntegration } from './jobs/registerJobs'
import {
	type ContentLockPluginOptions,
	CUSTOM_KEY,
	DEFAULT_ORDER,
	type ResolvedOptions,
	resolveOptions,
	SYSTEM_EXEMPT,
} from './options'
import { foldersSlugOf } from './plugin/foldersSlug'
import { registerTranslations } from './plugin/registerTranslations'
import { healSnapshot, readStoredWindows } from './state/store'

export { notEndedWhere } from './collection/access'
export type { ContentLockJobsOptions } from './jobs/registerJobs'
export type {
	ContentLockEditorFeature,
	ContentLockEditorFeaturesOption,
} from './lexical/editor'
export { ContentLockTokenFeature } from './lexical/token/server'
export type {
	ContentLockCustomTarget,
	ContentLockCustomTargetPath,
	ContentLockGroup,
	ContentLockPluginOptions,
} from './options'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/content-lock': ContentLockPluginOptions
	}
}

const PLUGIN_SLUG = '@10x-media/content-lock'

/** Fail the build on a group, custom target or exemption the config does not back. */
const assertKnownSlugs = (config: Config, options: ResolvedOptions): void => {
	const collections = new Set((config.collections ?? []).map((collection) => collection.slug))
	const folders = foldersSlugOf(config)
	if (folders) {
		collections.add(folders)
	}
	const globals = new Set((config.globals ?? []).map((global) => global.slug))
	const custom = new Set(options.customTargets.map((target) => target.key))
	const exempt = new Set(options.exempt)
	const builtIn = new Set<string>([options.slug, ...SYSTEM_EXEMPT, 'payload-folders'])
	for (const slug of exempt) {
		if (!builtIn.has(slug) && !collections.has(slug) && !globals.has(slug)) {
			throw new Error(`[content-lock] exempt names unknown collection or global "${slug}"`)
		}
	}
	const keys = new Set<string>()
	for (const group of options.groups) {
		if (keys.has(group.key)) {
			throw new Error(`[content-lock] duplicate group key "${group.key}"`)
		}
		keys.add(group.key)
		for (const slug of group.collections) {
			if (!collections.has(slug)) {
				throw new Error(`[content-lock] group "${group.key}" names unknown collection "${slug}"`)
			}
		}
		for (const slug of group.globals) {
			if (!globals.has(slug)) {
				throw new Error(`[content-lock] group "${group.key}" names unknown global "${slug}"`)
			}
		}
		for (const slug of [...group.collections, ...group.globals]) {
			if (exempt.has(slug)) {
				throw new Error(
					`[content-lock] group "${group.key}" names exempt "${slug}", which no lock freezes`
				)
			}
		}
		for (const key of group.custom) {
			if (!custom.has(key)) {
				throw new Error(
					`[content-lock] group "${group.key}" names undeclared custom target "${key}"`
				)
			}
		}
	}
}

/** Collections and globals that exempt themselves through `custom.contentLock.exempt`. */
const markedExempt = (config: Config): string[] =>
	[...(config.collections ?? []), ...(config.globals ?? [])]
		.filter((entity) => isMarkedExempt(entity))
		.map((entity) => entity.slug)

const definition = definePlugin<ContentLockPluginOptions>({
	slug: PLUGIN_SLUG,
	order: DEFAULT_ORDER,
	plugin: ({ config, plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const resolved = resolveOptions(options)
		resolved.exempt = [...new Set([...resolved.exempt, ...markedExempt(config)])]
		assertKnownSlugs(config, resolved)
		registerTranslations(config, options.translations)
		config.custom = { ...config.custom, [CUSTOM_KEY]: resolved }

		const lockCollection = buildLockCollection(config, resolved, options)
		registerEnforcement(config, resolved)
		registerJobsIntegration(config, options.jobs, Boolean(plugins['@10x-media/jobs']))
		config.collections = [...(config.collections ?? []), lockCollection]

		config.admin = {
			...config.admin,
			components: {
				...config.admin?.components,
				header: [
					`${PLUGIN_SLUG}/rsc#ContentLockHeader`,
					...(config.admin?.components?.header ?? []),
				],
				providers: [
					...(config.admin?.components?.providers ?? []),
					`${PLUGIN_SLUG}/client#ContentLockProvider`,
				],
			},
		}

		if (resolved.editorConverters) {
			config.admin.dependencies = {
				...config.admin.dependencies,
				[`content-lock:${resolved.editorConverters}`]: {
					path: resolved.editorConverters,
					type: 'function',
				},
			}
		}

		// A lock rejection is expected traffic, not a server fault: log it quietly.
		const loggingLevels = { ...config.loggingLevels } as Record<string, unknown>
		loggingLevels[CONTENT_LOCKED_ERROR_NAME] ??= 'info'
		config.loggingLevels = loggingLevels as Config['loggingLevels']

		const priorOnInit = config.onInit
		config.onInit = async (payload) => {
			await priorOnInit?.(payload)
			// Readers rebuild a missing or stale snapshot and reject writes until they can, so a kv
			// error here costs nothing but the log line; throwing would take the whole app down.
			try {
				await healSnapshot(payload, await readStoredWindows(payload))
			} catch (error) {
				payload.logger.error({
					err: error,
					msg: '[content-lock] cannot rebuild the lock snapshot at startup',
				})
			}
		}
		return config
	},
})

/**
 * Content Lock: planned and unplanned maintenance windows that freeze content.
 * Every write to a frozen collection or global is rejected with 503 on every
 * channel, the admin turns read-only, and a banner announces the window.
 */
export const contentLock = (options: ContentLockPluginOptions): Plugin => {
	const plugin = definition(options)
	if (options.order !== undefined) {
		plugin.order = options.order
	}
	return plugin
}

export { withoutContentLock } from './enforcement/bypass'
export {
	CONTENT_LOCKED_ERROR_NAME,
	ContentLockedError,
	type ContentLockedErrorData,
	isContentLockedError,
} from './enforcement/ContentLockedError'
export { getContentLockState, isContentLocked } from './state/store'
export type { ContentLockState, LockWindow, ResolvedScope, WindowStatus } from './state/types'
export type { ContentLockPluginOptions as PluginOptions }
