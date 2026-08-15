import type { Payload, PayloadRequest } from 'payload'

import { SECRET_REVEAL_CONTEXT } from '../constants'
import type { CodeSubscription } from '../options'
import { normalizeSecret } from '../secrets/format'

/** A subscription resolved from either source, ready to deliver to. */
export type ResolvedSubscription = {
	id: string
	source: 'collection' | 'code'
	url: string
	events: string[]
	/** Every secret a delivery must be signed with, active first. Empty means send unsigned. */
	secrets: string[]
	headers?: Record<string, string>
	enabled: boolean
}

/**
 * Normalize the secrets a delivery can sign with, dropping anything unusable. A read that never
 * opened a reveal window yields the mask instead of key material, and a failed decrypt yields
 * null; either would otherwise reach the HMAC as a bogus key and produce signatures no receiver
 * can verify. Dropping is safe here because malformed configured secrets are rejected loudly at
 * plugin registration, so a value that fails this late is a masked or undecryptable read.
 */
const signable = (values: (string | null | undefined)[]): string[] =>
	values.flatMap((value) => {
		if (typeof value !== 'string') {
			return []
		}
		try {
			return [normalizeSecret(value)]
		} catch {
			return []
		}
	})

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
	secrets: signable([row.secret]),
	headers: rowHeaders(row.headers),
	enabled: row.enabled !== false,
})

/** Normalize a code-defined subscription. */
export const fromCodeSubscription = (sub: CodeSubscription): ResolvedSubscription => ({
	id: sub.id,
	source: 'code',
	url: sub.url,
	events: sub.events,
	secrets: signable([sub.secret]),
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
