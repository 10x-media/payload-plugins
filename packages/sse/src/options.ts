import type { EventBroker, SSEOperation } from './broker/types'
import { multiTenantScope } from './scope/multiTenantScope'
import type { SSEScopeOptions } from './scope/types'
import type { TranslationsOption } from './translations'

export type { SSEScopeOptions } from './scope/types'
export type { SSEOperation }

export type CollectionSSEConfig = {
	events?: SSEOperation[]
	/** When true (default), hooks publish id-only thin events. */
	thinEvents?: boolean
}

export type PresenceIdentify = (user: unknown) => { id: string; label: string }

export type PresenceOptions = {
	heartbeatMs?: number
	leaseMs?: number
	identify?: PresenceIdentify
}

export type ResolvedPresenceOptions = {
	heartbeatMs: number
	leaseMs: number
	identify: PresenceIdentify
}

export type LiveListAdminOptions = {
	/** Prefer this field for the live-list Cell. Must be a scalar type. */
	field?: string
}

export type AdminOptions = {
	liveList?: boolean | LiveListAdminOptions
	presence?: boolean
}

export type ResolvedAdminOptions = {
	/** `false` disables; object enables (optional `field` for the Cell target). */
	liveList: false | LiveListAdminOptions
	presence: boolean
}

export type SSEPluginOptions = {
	disabled?: boolean
	translations?: TranslationsOption
	collections?: Record<string, true | CollectionSSEConfig>
	presence?: boolean | PresenceOptions
	admin?: boolean | AdminOptions
	/** Stream comment heartbeat interval. Default 15_000. Floor 1_000. */
	heartbeatMs?: number
	/** Concurrent SSE streams per user. Default 8. Floor 1. Over the cap returns 429. */
	maxConnectionsPerUser?: number
	broker?: EventBroker
	/**
	 * Tenant/site boundary for collection-wide topics. Omit/`false` off.
	 * `true` uses {@link multiTenantScope} defaults. An object supplies resolvers.
	 */
	scope?: boolean | SSEScopeOptions
}

export type ResolvedCollectionSSEConfig = {
	thinEvents: boolean
	events: SSEOperation[]
}

export type ResolvedSSEOptions = {
	collections: Record<string, ResolvedCollectionSSEConfig>
	/** Resolved presence config when enabled; `false` when omit/false. */
	presence: ResolvedPresenceOptions | false
	admin: ResolvedAdminOptions
	heartbeatMs: number
	maxConnectionsPerUser: number
	broker: EventBroker | undefined
	translations: TranslationsOption | undefined
	/** Resolved scope resolvers when enabled; `false` when omit/false. */
	scope: SSEScopeOptions | false
}

const DEFAULT_EVENTS: SSEOperation[] = ['create', 'update', 'delete']

const defaultIdentify: PresenceIdentify = (user) => {
	const id = String((user as { id: unknown }).id)
	return { id, label: id }
}

const resolvePresence = (
	presence: boolean | PresenceOptions | undefined
): ResolvedPresenceOptions | false => {
	if (presence === undefined || presence === false) {
		return false
	}
	const opts = presence === true ? {} : presence
	return {
		heartbeatMs: Math.max(1_000, opts.heartbeatMs ?? 10_000),
		leaseMs: Math.max(1_000, opts.leaseMs ?? 30_000),
		identify: opts.identify ?? defaultIdentify,
	}
}

const resolveScope = (scope: boolean | SSEScopeOptions | undefined): SSEScopeOptions | false => {
	if (scope === undefined || scope === false) {
		return false
	}
	if (scope === true) {
		return multiTenantScope()
	}
	return scope
}

const resolveLiveList = (
	liveList: boolean | LiveListAdminOptions | undefined
): false | LiveListAdminOptions => {
	if (liveList === false) return false
	if (liveList === undefined || liveList === true) return {}
	return liveList
}

const resolveAdmin = (
	admin: boolean | AdminOptions | undefined,
	presenceEnabled: boolean
): ResolvedAdminOptions => {
	if (admin === false || admin === undefined) {
		return { liveList: false, presence: false }
	}
	const opts = admin === true ? {} : admin
	return {
		liveList: resolveLiveList(opts.liveList),
		presence: presenceEnabled && opts.presence !== false,
	}
}

const resolveCollection = (cfg: true | CollectionSSEConfig): ResolvedCollectionSSEConfig => {
	if (cfg === true) {
		return { thinEvents: true, events: [...DEFAULT_EVENTS] }
	}
	return {
		thinEvents: cfg.thinEvents ?? true,
		events: cfg.events ?? [...DEFAULT_EVENTS],
	}
}

export const resolveSSEOptions = (options: SSEPluginOptions): ResolvedSSEOptions => {
	const collections: Record<string, ResolvedCollectionSSEConfig> = {}
	for (const [slug, cfg] of Object.entries(options.collections ?? {})) {
		collections[slug] = resolveCollection(cfg)
	}
	const presence = resolvePresence(options.presence)
	return {
		collections,
		presence,
		admin: resolveAdmin(options.admin, presence !== false),
		heartbeatMs: Math.max(1_000, options.heartbeatMs ?? 15_000),
		maxConnectionsPerUser: Math.max(1, options.maxConnectionsPerUser ?? 8),
		broker: options.broker,
		translations: options.translations,
		scope: resolveScope(options.scope),
	}
}
