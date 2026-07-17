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
 */
export const resolveAvailableLibraries = async (args: {
	adapters: IconAdapter[]
	data?: Record<string, unknown>
	req: PayloadRequest
	resolver?: IconAvailabilityResolver
	siblingData?: Record<string, unknown>
}): Promise<string[]> => {
	if (!args.resolver) {
		return args.adapters.map((adapter) => adapter.slug)
	}
	const resolver = args.resolver
	const resolved = await memoForRequest(args.req, keyFor(resolver), async () =>
		resolver({ data: args.data, req: args.req, siblingData: args.siblingData })
	)
	const allowed = new Set(resolved)
	return args.adapters.filter((adapter) => allowed.has(adapter.slug)).map((adapter) => adapter.slug)
}
