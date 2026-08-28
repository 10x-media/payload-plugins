import type { EventBroker, SSEOperation } from './broker/types'
import type { TranslationsOption } from './translations'

export type { SSEOperation }

export type CollectionSSEConfig = {
	events?: SSEOperation[]
	/** When true (default), hooks publish id-only thin events. */
	thinEvents?: boolean
}

export type PresenceOptions = {
	heartbeatMs?: number
	leaseMs?: number
	identify?: (user: unknown) => { id: string; label: string }
}

export type SSEPluginOptions = {
	disabled?: boolean
	translations?: TranslationsOption
	collections?: Record<string, true | CollectionSSEConfig>
	presence?: boolean | PresenceOptions
	admin?: boolean | { liveList?: boolean; presence?: boolean }
	/** Stream comment heartbeat interval. Default 15_000. */
	heartbeatMs?: number
	broker?: EventBroker
}

export type ResolvedCollectionSSEConfig = {
	thinEvents: boolean
	events: SSEOperation[]
}

export type ResolvedSSEOptions = {
	collections: Record<string, ResolvedCollectionSSEConfig>
	presence: boolean | PresenceOptions | undefined
	admin: boolean | { liveList?: boolean; presence?: boolean } | undefined
	heartbeatMs: number
	broker: EventBroker | undefined
	translations: TranslationsOption | undefined
}

const DEFAULT_EVENTS: SSEOperation[] = ['create', 'update', 'delete']

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
	return {
		collections,
		presence: options.presence,
		admin: options.admin,
		heartbeatMs: options.heartbeatMs ?? 15_000,
		broker: options.broker,
		translations: options.translations,
	}
}
