import type { PayloadRequest } from 'payload'
import type { IconAdapter, IconAvailabilityResolver } from '../../../types'
import { memoForRequest } from '../../../utils/memoForRequest'

const memoKeys = new WeakMap<IconAvailabilityResolver, symbol>()

const keyFor = (resolver: IconAvailabilityResolver): symbol => {
	let key = memoKeys.get(resolver)
	if (!key) {
		key = Symbol('fields:icon-availability')
		memoKeys.set(resolver, key)
	}
	return key
}

/**
 * Availability restricts SELECTION only; rendering stored values always works
 * through any registered adapter. Memoized per request per resolver, which is
 * safe because Field server components render one document per request.
 *
 * Fails open: a throwing resolver (e.g. a tenant lookup that errors) degrades to
 * all registered libraries and logs once, so it never 500s the edit view.
 * Availability gates selection, not data access, so all-registered is safe. The
 * catch lives inside the memo callback, so the rejection is never cached and a
 * later request retries.
 */
export const resolveAvailableLibraries = async (args: {
	adapters: IconAdapter[]
	data?: Record<string, unknown>
	/** Field identifier for the failure log, e.g. `${collectionSlug}.${fieldName}`. */
	fieldPath?: string
	req: PayloadRequest
	resolver?: IconAvailabilityResolver
	siblingData?: Record<string, unknown>
}): Promise<string[]> => {
	const allSlugs = (): string[] => args.adapters.map((adapter) => adapter.slug)
	const resolver = args.resolver
	if (!resolver) {
		return allSlugs()
	}
	const resolved = await memoForRequest(args.req, keyFor(resolver), async () => {
		try {
			return await resolver({ data: args.data, req: args.req, siblingData: args.siblingData })
		} catch (error) {
			args.req.payload.logger.error(
				{ err: error },
				`[fields] icon availability resolver failed${args.fieldPath ? ` for ${args.fieldPath}` : ''}; allowing all registered libraries`
			)
			return allSlugs()
		}
	})
	const allowed = new Set(resolved)
	return args.adapters.filter((adapter) => allowed.has(adapter.slug)).map((adapter) => adapter.slug)
}
