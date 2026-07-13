import type { PayloadRequest } from 'payload'

import { DEFAULT_DELIVERY_QUEUE, DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from './constants'
import type { TranslationsOption } from './translations'

export type WebhookOperation = 'create' | 'update' | 'delete'

export type CollectionWebhookConfig = {
	operations?: WebhookOperation[]
	includePreviousData?: boolean
	/**
	 * Reshape or redact a document before it is sent. Applied to the body's `data` and,
	 * when `includePreviousData` is set, to `previousData` as well, so redaction cannot
	 * be bypassed through the prior document. `target` names the slot being built; on
	 * the `previousData` call `doc` is the prior document and `previousDoc` is undefined.
	 */
	transform?: (args: {
		doc: Record<string, unknown>
		previousDoc?: Record<string, unknown>
		operation: WebhookOperation
		req: PayloadRequest
		target: 'data' | 'previousData'
	}) => unknown
}

export type CodeSubscription = {
	id: string
	url: string
	events: string[]
	secret?: string
	headers?: Record<string, string>
	enabled?: boolean
}

export type DeliveryMode = 'auto' | 'queue' | 'inline'

export type DeliveryOptions = {
	mode?: DeliveryMode
	timeoutMs?: number
	retries?: number
	queue?: string
}

export type WebhooksPluginOptions = {
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/webhooks/i18n`. Values win over
	 * the built-in locales key-by-key; locales the plugin does not ship are added
	 * whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	collections?: Record<string, true | CollectionWebhookConfig>
	subscriptions?: CodeSubscription[]
	delivery?: DeliveryMode | DeliveryOptions
	subscriptionsCollection?: { slug?: string; hidden?: boolean }
	deliveriesLog?: { slug?: string; hidden?: boolean }
}

export type ResolvedDeliveryOptions = {
	mode: DeliveryMode
	timeoutMs: number
	retries: number
	queue: string
}

export const resolveDeliveryOptions = (
	delivery: WebhooksPluginOptions['delivery']
): ResolvedDeliveryOptions => {
	const opts: DeliveryOptions =
		delivery === undefined ? {} : typeof delivery === 'string' ? { mode: delivery } : delivery
	return {
		mode: opts.mode ?? 'auto',
		timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		retries: opts.retries ?? DEFAULT_RETRIES,
		queue: opts.queue ?? DEFAULT_DELIVERY_QUEUE,
	}
}
