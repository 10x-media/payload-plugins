import type { CollectionSlug, IncomingAuthType } from 'payload'

import type { TranslationsOption } from './translations'

/**
 * Which session a request is allowed to be authenticated against.
 *
 * - `admin`: only the admin panel's own cookie (`${cookiePrefix}-token`) may populate `req.user`
 * - `frontend`: isolated collection cookies may populate `req.user`
 */
export type AuthScope = 'admin' | 'frontend'

export type IsolatedCollection = {
	/**
	 * Full cookie name holding this collection's token.
	 * @default `${cookiePrefix}-${slug}-token`
	 */
	cookieName?: string
	/**
	 * Scopes in which this collection's cookie is allowed to authenticate a request.
	 * Only enforced when the auth-scope proxy is installed.
	 * @default ['frontend']
	 */
	scopes?: AuthScope[]
	slug: CollectionSlug
}

export type DualSessionPluginOptions = {
	/**
	 * When no scope header is present on a request, ignore isolated cookies as long as a
	 * valid admin-collection token is also present. Keeps the admin panel usable in
	 * projects that have not installed the auth-scope proxy.
	 * @default true
	 */
	adminSessionPriority?: boolean
	/**
	 * Auth collections to move off the shared `${cookiePrefix}-token` cookie.
	 * The collection configured as `admin.user` must not be listed — it owns the shared cookie.
	 *
	 * Order is priority: when a visitor holds sessions for more than one of these at
	 * once, the earliest listed collection wins.
	 */
	collections: (CollectionSlug | IsolatedCollection)[]
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Request header the auth-scope proxy writes the resolved scope into.
	 * @default 'x-payload-auth-scope'
	 */
	scopeHeader?: string
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/dual-session/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

export type ResolvedIsolatedCollection = Required<Omit<IsolatedCollection, 'cookieName'>> & {
	cookieName: string
}

/** Payload does not export the `AuthStrategy` object type directly. */
export type AuthStrategy = NonNullable<IncomingAuthType['strategies']>[number]
