import type { CollectionSlug, GlobalSlug, PayloadRequest } from 'payload'

import type {
	ConversationsAccess,
	ConversationsExtension,
	ConversationsTarget,
	MessageTypeDefinition,
} from '../types'

/**
 * Declare a custom message type with typed `data`. Curried so `TData` is given
 * explicitly while the rest is inferred:
 * `defineMessageType<{ from: string; to: string }>()({ slug: 'ticket.status', ... })`.
 */
export const defineMessageType =
	<TData = unknown>() =>
	(definition: MessageTypeDefinition<TData>): MessageTypeDefinition<TData> =>
		definition

/** Declare an extension. Identity at runtime; exists for inference. */
export const defineExtension = <TOptions = unknown>(
	extension: ConversationsExtension & { options?: TOptions }
): ConversationsExtension & { options?: TOptions } => extension

export type PerTargetCheck = (args: {
	/** The target document at depth 0 when `load` is set; `null` if it does not exist. */
	doc?: null | Record<string, unknown>
	req: PayloadRequest
	target: ConversationsTarget
}) => boolean | Promise<boolean>

/**
 * Conversation access from a per-target predicate, for simple cases. With
 * `load: true` the target documents are loaded first, one query per
 * collection (depth 0, access overridden), and a missing document is denied.
 */
export const perTarget =
	(check: PerTargetCheck, options: { load?: boolean } = {}): ConversationsAccess =>
	async ({ req, targets }) => {
		const docs = new Map<string, null | Record<string, unknown>>()
		if (options.load) {
			const byCollection = new Map<string, ConversationsTarget[]>()
			for (const target of targets) {
				if (target.kind === 'collection' && target.id) {
					byCollection.set(target.slug, [...(byCollection.get(target.slug) ?? []), target])
				}
			}
			await Promise.all([
				...[...byCollection].map(async ([collection, list]) => {
					const result = await req.payload.find({
						collection: collection as CollectionSlug,
						depth: 0,
						limit: list.length,
						overrideAccess: true,
						pagination: false,
						req,
						where: { id: { in: list.map((target) => target.id) } },
					})
					const byId = new Map(
						(result.docs as unknown as Array<Record<string, unknown>>).map((doc) => [
							String(doc.id),
							doc,
						])
					)
					for (const target of list) {
						docs.set(target.key, byId.get(String(target.id)) ?? null)
					}
				}),
				...targets
					.filter((target) => target.kind === 'global')
					.map(async (target) => {
						const doc = await req.payload.findGlobal({
							depth: 0,
							overrideAccess: true,
							req,
							slug: target.slug as GlobalSlug,
						})
						docs.set(target.key, doc as Record<string, unknown>)
					}),
			])
		}
		const results = await Promise.all(
			targets.map(async (target) => {
				if (options.load && target.kind === 'collection' && docs.get(target.key) === null) {
					return false
				}
				return check({ doc: docs.get(target.key), req, target })
			})
		)
		return targets.filter((_, index) => results[index]).map((target) => target.key)
	}
