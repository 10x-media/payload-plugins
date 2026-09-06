import { validateEncryptedBoot, withEncryptedQueryRewrite } from '@10x-media/fields/encrypted'
import {
	type CollectionSlug,
	type Config,
	type Endpoint,
	Forbidden,
	type PayloadRequest,
} from 'payload'

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
	resolveSecretRotationOptions,
	type WebhooksPluginOptions,
} from '../options'
import { InvalidSecretError, normalizeSecret } from '../secrets/format'
import { RotationConflictError, rotateSubscriptionSecret } from '../secrets/rotate'
import { applyCollectionOverride } from './applyCollectionOverride'
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

/**
 * Validate a rotate-secret request body. The configured grace period is checked at config build,
 * but a per-request override arrives from the network: an unbounded value would keep an exposed
 * secret signing for years, and a non-numeric one would slip past `graceSeconds > 0` and retire
 * the old secret instantly with no window and no error.
 */
const parseRotateBody = (body: unknown): { secret?: string; graceSeconds?: number } => {
	const raw = (body ?? {}) as Record<string, unknown>
	if (raw.secret !== undefined && typeof raw.secret !== 'string') {
		throw new Error('secret must be a string')
	}
	if (raw.graceSeconds === undefined) {
		return { secret: raw.secret as string | undefined }
	}
	if (typeof raw.graceSeconds !== 'number' || !Number.isFinite(raw.graceSeconds)) {
		throw new Error('graceSeconds must be a finite number')
	}
	return { secret: raw.secret as string | undefined, graceSeconds: raw.graceSeconds }
}

/**
 * Evaluate the subscriptions collection's configured `update` access for one document, honouring
 * a `Where` result by checking that the target actually matches it. Read from the runtime config
 * so a consumer's override of the collection governs this endpoint too.
 *
 * Throwing `Forbidden` is as valid a denial as returning false, and Payload's own `executeAccess`
 * lets it propagate, so an access function written that way would otherwise reach the handler's
 * generic catch and be reported as a 500.
 */
const canUpdateSubscription = async (args: {
	req: PayloadRequest
	slug: string
	id: string
}): Promise<boolean> => {
	const { req, slug, id } = args
	const access = req.payload.collections?.[slug as CollectionSlug]?.config?.access?.update
	if (!access) {
		return true
	}
	let result: Awaited<ReturnType<typeof access>>
	try {
		result = await access({ req, id })
	} catch (err) {
		if (err instanceof Forbidden) {
			return false
		}
		throw err
	}
	if (typeof result === 'boolean') {
		return result
	}
	const scoped = await req.payload.find({
		collection: slug as CollectionSlug,
		where: { and: [{ id: { equals: id } }, result] },
		limit: 1,
		depth: 0,
		overrideAccess: true,
		req,
	})
	return scoped.docs.length > 0
}

/**
 * MongoDB `WriteConflict`, and Postgres `serialization_failure` / `deadlock_detected`. Drivers
 * carry these as codes, which is the reliable signal; the message check stays as a fallback for
 * wrappers that re-throw without one.
 */
const WRITE_CONFLICT_CODES = new Set<number | string>([112, '40001', '40P01', 40001])

/** A concurrent-write rejection from the database, which the caller should retry. */
const isWriteConflict = (err: unknown): boolean => {
	const code = (err as { code?: number | string })?.code
	if (code !== undefined && WRITE_CONFLICT_CODES.has(code)) {
		return true
	}
	const message = err instanceof Error ? err.message : String(err)
	return /write conflict|could not serialize|deadlock detected/i.test(message)
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
	const rotation = resolveSecretRotationOptions(options.secretRotation)
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
	// The response strip and the where-rewrite that write-only secrets depend on are attached
	// here rather than left to the fields() plugin, so the secrets stay off every read result
	// whether or not the consumer installed it.
	const subscriptions = withEncryptedQueryRewrite(
		buildSubscriptionsCollection({
			slug: subscriptionsSlug,
			events: catalog,
			hidden: options.subscriptionsCollection?.hidden ?? false,
			secretKeys: options.secretEncryption?.keys,
		})
	)

	const rotateSecretEndpoint: Endpoint = {
		path: '/:id/rotate-secret',
		method: 'post',
		handler: async (req) => {
			if (!req.user) {
				return Response.json({ error: 'unauthorized' }, { status: 401 })
			}
			const id = req.routeParams?.id
			if (typeof id !== 'string') {
				return Response.json({ error: 'missing id' }, { status: 400 })
			}
			// Rotation is a privileged write, so it defers to the collection's own update access for
			// this document rather than accepting any logged-in user. Tightening `access.update`, or
			// scoping it per tenant, governs the endpoint too.
			if (!(await canUpdateSubscription({ req, slug: subscriptionsSlug, id }))) {
				return Response.json({ error: 'forbidden' }, { status: 403 })
			}
			const body = (await req.json?.().catch(() => ({}))) as unknown

			let secret: string | undefined
			let graceSeconds: number
			try {
				const parsed = parseRotateBody(body)
				secret = parsed.secret
				graceSeconds =
					parsed.graceSeconds === undefined
						? rotation.graceSeconds
						: resolveSecretRotationOptions({ graceSeconds: parsed.graceSeconds }).graceSeconds
			} catch (err) {
				return Response.json({ error: (err as Error).message }, { status: 400 })
			}

			try {
				const result = await rotateSubscriptionSecret({
					payload: req.payload,
					req,
					subscriptionsSlug,
					id,
					secret,
					graceSeconds,
				})
				return Response.json(result, { status: 200 })
			} catch (err) {
				if (err instanceof InvalidSecretError) {
					return Response.json({ error: err.message }, { status: 400 })
				}
				if (err instanceof RotationConflictError || isWriteConflict(err)) {
					return Response.json(
						{ error: 'the subscription was modified concurrently; retry the rotation' },
						{ status: 409 }
					)
				}
				req.payload.logger.error(
					`@10x-media/webhooks: rotating the secret for subscription ${id} failed: ${err instanceof Error ? err.message : String(err)}`
				)
				return Response.json({ error: 'could not rotate the secret' }, { status: 500 })
			}
		},
	}
	subscriptions.endpoints = [...(subscriptions.endpoints || []), rotateSecretEndpoint]
	config.collections.push(
		applyCollectionOverride(subscriptions, options.subscriptionsCollection?.overrides)
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
	config.collections.push(applyCollectionOverride(deliveries, options.deliveriesLog?.overrides))

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

	/**
	 * Resolve the key ring at boot rather than on the first delivery.
	 *
	 * The `fields()` plugin does this for its own consumers; this plugin calls `encryptedField`
	 * standalone, the same reason it applies `withEncryptedQueryRewrite` itself, so the check is
	 * its to make. Without it a misconfigured `secretEncryption.keys` (an env var that resolved
	 * empty, key material under the entropy floor, a provider that throws) boots clean and first
	 * surfaces as a refused delivery, which reads like a corrupt secret rather than a bad config.
	 */
	const previousOnInit = config.onInit
	config.onInit = async (payload) => {
		await previousOnInit?.(payload)
		// No plugin-level keys argument: the factory stamps `secretEncryption.keys` onto each
		// marker, so the scan already sees them, and passing them again would mask whether any
		// field still falls back to the PAYLOAD_SECRET-derived ring.
		await validateEncryptedBoot(payload)
	}
}
