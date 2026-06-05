import type { Payload, PayloadRequest } from 'payload'

import { SECRET_REVEAL_CONTEXT } from '../constants'
import type { CodeSubscription } from '../options'

/** A subscription resolved from either source, ready to deliver to. */
export type ResolvedSubscription = {
	id: string
	source: 'collection' | 'code'
	url: string
	events: string[]
	secret?: string
	headers?: Record<string, string>
	enabled: boolean
}

const rowHeaders = (
	headers?: { key?: string | null; value?: string | null }[] | null
): Record<string, string> | undefined => {
	if (!headers?.length) {
		return undefined
	}
	const out: Record<string, string> = {}
	for (const h of headers) {
		if (h.key) {
			out[h.key] = h.value ?? ''
		}
	}
	return Object.keys(out).length ? out : undefined
}

/** Normalize a subscriptions-collection document. */
export const fromCollectionRow = (row: {
	id: string | number
	url: string
	events?: string[] | null
	secret?: string | null
	headers?: { key?: string | null; value?: string | null }[] | null
	enabled?: boolean | null
}): ResolvedSubscription => ({
	id: String(row.id),
	source: 'collection',
	url: row.url,
	events: row.events ?? [],
	secret: row.secret ?? undefined,
	headers: rowHeaders(row.headers),
	enabled: row.enabled !== false,
})

/** Normalize a code-defined subscription. */
export const fromCodeSubscription = (sub: CodeSubscription): ResolvedSubscription => ({
	id: sub.id,
	source: 'code',
	url: sub.url,
	events: sub.events,
	secret: sub.secret,
	headers: sub.headers,
	enabled: sub.enabled !== false,
})

/** Enabled subscriptions listening for `event`. */
export const matchSubscriptions = (
	subs: ResolvedSubscription[],
	event: string
): ResolvedSubscription[] => subs.filter((s) => s.enabled && s.events.includes(event))

/** Look up one subscription by id (code first, then the collection). */
export const resolveSubscriptionById = async (args: {
	id: string
	codeSubscriptions: CodeSubscription[]
	subscriptionsSlug: string
	payload: Payload
	req: PayloadRequest
}): Promise<ResolvedSubscription | null> => {
	const code = args.codeSubscriptions.find((s) => s.id === args.id)
	if (code) {
		return fromCodeSubscription(code)
	}
	args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = true
	try {
		const res = await args.payload.find({
			collection: args.subscriptionsSlug,
			where: { id: { equals: args.id } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
			req: args.req,
		})
		const row = res.docs[0] as Parameters<typeof fromCollectionRow>[0] | undefined
		return row ? fromCollectionRow(row) : null
	} finally {
		args.req.context[SECRET_REVEAL_CONTEXT.forSigning] = false
	}
}
