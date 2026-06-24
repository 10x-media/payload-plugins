import type { PayloadRequest } from 'payload'

import { eventId } from '../events/eventTypes'
import type { CollectionWebhookConfig, WebhookOperation } from '../options'

/** The JSON body POSTed to a subscriber. */
export type WebhookBody = {
	id: string
	event: string
	collection: string
	operation: WebhookOperation
	occurredAt: string
	data: unknown
	previousData?: unknown
}

/** Build the outbound body, applying any per-collection transform/redaction. */
export const buildPayload = (args: {
	deliveryId: string
	collection: string
	operation: WebhookOperation
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	occurredAt: string
	config?: CollectionWebhookConfig
	req: PayloadRequest
}): WebhookBody => {
	const { deliveryId, collection, operation, doc, previousDoc, occurredAt, config, req } = args
	const data = config?.transform ? config.transform({ doc, previousDoc, operation, req }) : doc
	const body: WebhookBody = {
		id: deliveryId,
		event: eventId(collection, operation),
		collection,
		operation,
		occurredAt,
		data,
	}
	if (operation === 'update' && config?.includePreviousData && previousDoc) {
		body.previousData = previousDoc
	}
	return body
}
