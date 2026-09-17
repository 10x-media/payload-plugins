/** This plugin's registered slug, used to find its options on a booted config. */
export const PLUGIN_SLUG = '@10x-media/impersonation'

/** `config.custom` key the resolved options live under. */
export const REGISTRY_KEY = PLUGIN_SLUG

export const DEFAULT_COLLECTION_SLUG = 'impersonation-sessions'
export const DEFAULT_API_PATH = '/impersonation'
export const DEFAULT_HINT_COOKIE = 'impersonation-hint'
export const DEFAULT_COOKIE_PREFIX = 'payload'
export const defaultClearOnSwitch = (cookiePrefix: string) => [`${cookiePrefix}-tenant`]
export const REASON_MAX_LENGTH = 500
export const ADMIN_GROUP = 'System'

export const RESERVED_API_SEGMENTS = ['graphql', 'graphql-playground'] as const
