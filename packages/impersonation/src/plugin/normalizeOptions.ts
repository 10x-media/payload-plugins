import type { CollectionConfig, CollectionSlug, Config } from 'payload'

import type { EnabledOptions, ResolvedOptions, ResolvedUi } from '../types'
import {
	DEFAULT_API_PATH,
	DEFAULT_COLLECTION_SLUG,
	DEFAULT_COOKIE_PREFIX,
	DEFAULT_HINT_COOKIE,
	defaultClearOnSwitch,
	RESERVED_API_SEGMENTS,
} from './constants'

const PREFIX = '@10x-media/impersonation:'

export const resolveAdminUserSlug = (config: Config): string =>
	config.admin?.user ??
	(config.collections ?? []).find(({ auth }) => Boolean(auth))?.slug ??
	'users'

const authObject = (collection: CollectionConfig | undefined) => {
	if (!collection?.auth) {
		return null
	}
	return typeof collection.auth === 'object' ? collection.auth : {}
}

const firstApiSegment = (apiPath: string): string =>
	apiPath.replace(/^\//, '').split('/').filter(Boolean)[0] ?? ''

const resolveUi = (ui: EnabledOptions['ui']): ResolvedUi => {
	if (ui === false) {
		return { bar: false, documentAction: false, headerAction: false, recordAction: false }
	}
	return {
		bar: ui?.bar !== false,
		documentAction: ui?.documentAction !== false,
		headerAction: ui?.headerAction !== false,
		recordAction: ui?.recordAction !== false,
	}
}

/**
 * Fill defaults and refuse a config that cannot bind or revoke sessions.
 * `disabled: true` never reaches here.
 */
export const normalizeOptions = (options: EnabledOptions, config: Config): ResolvedOptions => {
	if (typeof options.access?.impersonate !== 'function') {
		throw new Error(`${PREFIX} access.impersonate must be a function`)
	}

	const cookiePrefix = config.cookiePrefix ?? DEFAULT_COOKIE_PREFIX
	const collectionSlug = (options.collectionSlug ?? DEFAULT_COLLECTION_SLUG) as CollectionSlug
	const apiPath = options.apiPath ?? DEFAULT_API_PATH
	const hintCookieName = options.hintCookieName ?? DEFAULT_HINT_COOKIE

	if (hintCookieName.startsWith(cookiePrefix)) {
		throw new Error(
			`${PREFIX} hintCookieName "${hintCookieName}" must not start with cookiePrefix "${cookiePrefix}". @payloadcms/next refresh/logout take the first cookie whose name starts with the prefix.`
		)
	}

	const segment = firstApiSegment(apiPath)
	const occupied = new Set<string>([
		...RESERVED_API_SEGMENTS,
		collectionSlug,
		...(config.collections ?? []).map(({ slug }) => slug),
		...(config.globals ?? []).map(({ slug }) => slug),
	])
	if (!segment || occupied.has(segment)) {
		throw new Error(
			`${PREFIX} apiPath "${apiPath}" collides with a collection, global, or reserved route segment "${segment}". handleEndpoints would treat it as that collection and drop these endpoints.`
		)
	}

	const adminSlug = resolveAdminUserSlug(config)
	const adminCollection = (config.collections ?? []).find(({ slug }) => slug === adminSlug)
	const adminAuth = authObject(adminCollection)
	if (adminAuth?.useSessions === false) {
		throw new Error(
			`${PREFIX} the admin collection "${adminSlug}" has useSessions: false, so there is no sid to bind or revoke.`
		)
	}
	if (adminAuth?.disableLocalStrategy) {
		throw new Error(
			`${PREFIX} the admin collection "${adminSlug}" has disableLocalStrategy, so the plugin cannot mint or restore a session.`
		)
	}

	return {
		access: {
			impersonate: options.access.impersonate,
			readRecords: options.access.readRecords ?? (() => false),
			terminate: options.access.terminate ?? (() => false),
		},
		apiPath,
		collectionSlug,
		cookies: {
			clearOnSwitch: options.cookies?.clearOnSwitch ?? defaultClearOnSwitch(cookiePrefix),
		},
		decorateRequests: options.decorateRequests !== false,
		hintCookieName,
		maxDuration: options.maxDuration,
		onEnd: options.onEnd,
		onStart: options.onStart,
		reason: options.reason ?? 'off',
		security: { trustedOrigins: options.security?.trustedOrigins ?? [] },
		session: options.session ?? {},
		targets: options.targets,
		ui: resolveUi(options.ui),
	}
}
