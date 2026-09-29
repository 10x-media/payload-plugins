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
/** Client POSTs that busy-gate a control abort after this. */
export const CLIENT_FETCH_TIMEOUT_MS = 15_000
export const ADMIN_GROUP = 'System'
/** Prefixed onto minted target sids so decorateAuth can skip the DB on normal traffic. */
export const IMPERSONATION_SID_PREFIX = 'imp_'
export const SWITCHER_PAGE_SIZE = 20

export const RESERVED_API_SEGMENTS = ['graphql', 'graphql-playground'] as const
