import type { Config, Endpoint } from 'payload'

import { buildDeliveriesCollection } from '../collections/deliveries'
import { buildSubscriptionsCollection } from '../collections/subscriptions'
import { DEFAULT_DELIVERIES_SLUG, DEFAULT_SUBSCRIPTIONS_SLUG, RESERVED_SLUGS } from '../constants'
import { buildDeliverTask } from '../delivery/deliverTask'
import { isReservedHeader, RESERVED_HEADER_NAMES } from '../delivery/headers'
import { redeliverDelivery } from '../delivery/redeliver'
import { eventCatalog } from '../events/eventTypes'
import { makeAfterChange, makeAfterDelete } from '../events/hooks'
import {
	type CodeSubscription,
	type CollectionWebhookConfig,
	resolveDeliveryOptions,
	type WebhooksPluginOptions,
} from '../options'
import { InvalidSecretError, normalizeSecret } from '../secrets/format'
import { resolveMode } from './resolveMode'

/**
 * Reject a malformed code-subscription secret at config build rather than at delivery. A secret
 * that is not valid `whsec_<base64>` derives a different HMAC key than any Standard Webhooks
 * verifier expects, which would otherwise surface as receivers silently rejecting every delivery.
 */
const assertCodeSubscriptionSecrets = (subscriptions: CodeSubscription[]): void => {
	for (const subscription of subscriptions) {
		if (subscription.secret === undefined) {
			continue
		}
		try {
			normalizeSecret(subscription.secret)
		} catch (err) {
			const reason = err instanceof InvalidSecretError ? err.reason : String(err)
			throw new InvalidSecretError(reason, `code subscription '${subscription.id}' is unusable`)
		}
	}
}

/**
 * Refuse a code subscription that tries to set a header the delivery pipeline owns. Runtime
 * filtering already drops these, so failing here is about telling the author rather than
 * letting a silently ignored header look like it worked.
 */
const assertCodeSubscriptionHeaders = (subscriptions: CodeSubscription[]): void => {
	for (const subscription of subscriptions) {
		for (const key of Object.keys(subscription.headers ?? {})) {
			if (isReservedHeader(key)) {
				throw new Error(
					`@10x-media/webhooks: code subscription '${subscription.id}' sets the reserved header '${key}'. The plugin sets ${RESERVED_HEADER_NAMES.join(', ')} on every delivery.`
				)
			}
		}
	}
}

/** Register collections, the delivery task, source hooks, and the redeliver endpoint. */
export const registerWebhooks = (args: {
	config: Config
	options: WebhooksPluginOptions
	hasJobsPlugin: boolean
}): void => {
	const { config, options } = args
	const sources = options.collections ?? {}
	const subscriptionsSlug = options.subscriptionsCollection?.slug ?? DEFAULT_SUBSCRIPTIONS_SLUG
	const deliveriesSlug = options.deliveriesLog?.slug ?? DEFAULT_DELIVERIES_SLUG
	const reserved = new Set<string>([...RESERVED_SLUGS, subscriptionsSlug, deliveriesSlug])
	const sourceSlugs = Object.keys(sources).filter((s) => !reserved.has(s))
	const delivery = resolveDeliveryOptions(options.delivery)
	const codeSubscriptions = options.subscriptions ?? []
	assertCodeSubscriptionSecrets(codeSubscriptions)
	assertCodeSubscriptionHeaders(codeSubscriptions)
	const catalog = eventCatalog(Object.fromEntries(sourceSlugs.map((s) => [s, sources[s] ?? true])))

	const mode = resolveMode({
		configured: delivery.mode,
		hasAutoRun: Boolean(config.jobs?.autoRun),
		hasJobsPlugin: args.hasJobsPlugin,
		// config-build time: payload.logger does not exist yet, so console is the only channel
		warn: (m) => console.warn(m),
	})

	config.collections ??= []
	config.collections.push(
		buildSubscriptionsCollection({
			slug: subscriptionsSlug,
			events: catalog,
			hidden: options.subscriptionsCollection?.hidden ?? false,
		})
	)
	const deliveries = buildDeliveriesCollection({
		slug: deliveriesSlug,
		hidden: options.deliveriesLog?.hidden ?? false,
	})

	const redeliverEndpoint: Endpoint = {
		path: '/:id/redeliver',
		method: 'post',
		handler: async (req) => {
			// coarse auth: any logged-in user may redeliver any delivery (matches the deliveries collection access)
			if (!req.user) {
				return Response.json({ error: 'unauthorized' }, { status: 401 })
			}
			const id = req.routeParams?.id
			if (typeof id !== 'string') {
				return Response.json({ error: 'missing id' }, { status: 400 })
			}
			const result = await redeliverDelivery({
				deps: {
					deliveriesSlug,
					subscriptionsSlug,
					codeSubscriptions,
					mode,
					timeoutMs: delivery.timeoutMs,
					queue: delivery.queue,
				},
				deliveryId: id,
				payload: req.payload,
				req,
			})
			return Response.json(result, { status: 202 })
		},
	}
	deliveries.endpoints = [...(deliveries.endpoints || []), redeliverEndpoint]
	config.collections.push(deliveries)

	config.jobs ??= {}
	config.jobs.tasks ??= []
	config.jobs.tasks.push(
		buildDeliverTask({
			deliveriesSlug,
			subscriptionsSlug,
			codeSubscriptions,
			timeoutMs: delivery.timeoutMs,
			retries: delivery.retries,
		})
	)

	for (let i = 0; i < config.collections.length; i++) {
		const collection = config.collections[i]
		if (!collection || !sourceSlugs.includes(collection.slug)) {
			continue
		}
		const cfg = sources[collection.slug]
		const collectionConfig: CollectionWebhookConfig = cfg === true || cfg === undefined ? {} : cfg
		const deps = {
			collectionSlug: collection.slug,
			config: collectionConfig,
			operations: collectionConfig.operations ?? [
				'create' as const,
				'update' as const,
				'delete' as const,
			],
			deliveriesSlug,
			subscriptionsSlug,
			codeSubscriptions,
			mode,
			timeoutMs: delivery.timeoutMs,
			queue: delivery.queue,
		}
		config.collections[i] = {
			...collection,
			hooks: {
				...collection.hooks,
				afterChange: [...(collection.hooks?.afterChange ?? []), makeAfterChange(deps)],
				afterDelete: [...(collection.hooks?.afterDelete ?? []), makeAfterDelete(deps)],
			},
		}
	}
}
