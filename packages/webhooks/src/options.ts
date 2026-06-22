import type { PayloadRequest } from 'payload'

import { DEFAULT_DELIVERY_QUEUE, DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS } from './constants'

export type WebhookOperation = 'create' | 'update' | 'delete'

export type CollectionWebhookConfig = {
	operations?: WebhookOperation[]
	includePreviousData?: boolean
	transform?: (args: {
		doc: Record<string, unknown>
		previousDoc?: Record<string, unknown>
		operation: WebhookOperation
		req: PayloadRequest
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
	collections?: Record<string, true | CollectionWebhookConfig>
	subscriptions?: CodeSubscription[]
	delivery?: DeliveryMode | DeliveryOptions
	subscriptionsCollection?: { slug?: string; hidden?: boolean }
	deliveriesLog?: { slug?: string; hidden?: boolean }
	/** Access guard for the redeliver endpoint. Defaults to any logged-in user. */
	redeliverAccess?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
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
