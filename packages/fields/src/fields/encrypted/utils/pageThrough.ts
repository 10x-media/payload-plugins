import type { Payload } from 'payload'
import { ENCRYPTED_CONTEXT_KEY } from '../types'

export interface PageThroughArgs {
	batchSize: number
	collection: string
	payload: Payload
}

/**
 * Iterates a collection in id-sorted pages with hooks in 'raw' mode, so
 * encrypted values arrive as stored ciphertext. Updates during iteration do
 * not change membership (no filter), so page order stays stable.
 */
export async function* pageThrough({
	batchSize,
	collection,
	payload,
}: PageThroughArgs): AsyncGenerator<Record<string, unknown>[]> {
	let page = 1
	for (;;) {
		const result = await payload.find({
			collection: collection as never,
			context: { [ENCRYPTED_CONTEXT_KEY]: 'raw' },
			depth: 0,
			limit: batchSize,
			locale: 'all',
			overrideAccess: true,
			page,
			sort: 'id',
		})
		if (result.docs.length > 0) {
			yield result.docs as unknown as Record<string, unknown>[]
		}
		if (!result.hasNextPage) {
			return
		}
		page += 1
	}
}

export const getAtPath = (doc: Record<string, unknown>, path: string): unknown =>
	path.split('.').reduce<unknown>((node, segment) => {
		if (node && typeof node === 'object') {
			return (node as Record<string, unknown>)[segment]
		}
		return undefined
	}, doc)

export const setAtPath = (target: Record<string, unknown>, path: string, value: unknown): void => {
	const segments = path.split('.')
	let node = target
	for (const segment of segments.slice(0, -1)) {
		const next = node[segment]
		if (!next || typeof next !== 'object') {
			node[segment] = {}
		}
		node = node[segment] as Record<string, unknown>
	}
	node[segments[segments.length - 1] as string] = value
}
