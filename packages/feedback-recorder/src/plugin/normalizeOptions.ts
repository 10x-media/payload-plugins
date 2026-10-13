import type { Config } from 'payload'

import type { FeedbackRecorderEnabledOptions, RecorderAccess, ResolvedOptions } from '../types'
import { DEFAULT_API_PATH, PREFIX } from './constants'

const trimmed = (value: string | undefined): string | null => {
	const next = value?.trim()
	return next ? next : null
}

const normalizeApiPath = (value: string | undefined): string => {
	const raw = trimmed(value) ?? DEFAULT_API_PATH
	const path = `/${raw.replace(/^\/+|\/+$/g, '')}`
	if (path === '/' || /[?#\s]/.test(path)) {
		throw new Error(`${PREFIX} apiPath must be a plain path such as "/feedback-recorder"`)
	}
	return path
}

const normalizeUrl = (value: string | undefined): string | null => {
	const raw = trimmed(value)
	if (!raw) return null
	let parsed: URL
	try {
		parsed = new URL(raw)
	} catch {
		throw new Error(`${PREFIX} url must be an absolute URL, got "${raw}"`)
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error(`${PREFIX} url must use http or https`)
	}
	return parsed.toString().replace(/\/+$/, '')
}

const defaultAccess =
	(adminCollection: string | undefined): RecorderAccess =>
	({ payload, user }) =>
		user.collection === (adminCollection ?? payload.config.admin.user)

/**
 * Fills defaults and refuses options that would fail later in a less obvious place. A missing url
 * or key is not an error: the recorder simply stays hidden, which is what a preview or demo
 * environment without the 10x connection wants.
 */
export const normalizeOptions = (
	options: FeedbackRecorderEnabledOptions,
	config: Pick<Config, 'admin' | 'collections' | 'globals'>
): ResolvedOptions => {
	if (options.access !== undefined && typeof options.access !== 'function') {
		throw new Error(`${PREFIX} access must be a function`)
	}

	const apiPath = normalizeApiPath(options.apiPath)
	const firstSegment = apiPath.split('/')[1]
	const taken = [
		...(config.collections ?? []).map((entry) => entry.slug),
		...(config.globals ?? []).map((entry) => entry.slug),
	]
	if (firstSegment && taken.includes(firstSegment)) {
		throw new Error(
			`${PREFIX} apiPath "${apiPath}" collides with the "${firstSegment}" collection or global`
		)
	}

	const url = normalizeUrl(options.url)
	const apiKey = trimmed(options.apiKey)

	return {
		url,
		apiKey,
		configured: Boolean(url && apiKey),
		access: options.access ?? defaultAccess(config.admin?.user),
		appVersion: trimmed(options.appVersion),
		captureConsole: options.captureConsole === true,
		apiPath,
		headerAction: options.headerAction !== false,
	}
}
