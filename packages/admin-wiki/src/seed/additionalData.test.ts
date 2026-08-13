import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveAdditionalData } from './additionalData'

/** Only handed on, never called here: the resolver does not read it. */
const payload = {} as Payload

describe('resolveAdditionalData', () => {
	it('resolves nothing to an empty object, so the caller can spread it unconditionally', async () => {
		await expect(resolveAdditionalData(undefined, payload, 'guide')).resolves.toEqual({})
	})

	it('passes an object through', async () => {
		await expect(
			resolveAdditionalData({ audience: 'editors', reviewedAt: '2026-01-01' }, payload, 'guide')
		).resolves.toEqual({ audience: 'editors', reviewedAt: '2026-01-01' })
	})

	it('calls the function form with the payload instance', async () => {
		const seen: Payload[] = []
		const resolved = await resolveAdditionalData(
			(instance) => {
				seen.push(instance)
				return { category: 7 }
			},
			payload,
			'guide'
		)

		expect(seen).toEqual([payload])
		expect(resolved).toEqual({ category: 7 })
	})

	it('awaits an async function form, which is the point of taking payload at all', async () => {
		await expect(
			resolveAdditionalData(async () => ({ category: 7 }), payload, 'guide')
		).resolves.toEqual({ category: 7 })
	})

	it('rejects a field the seed writes itself, naming it', async () => {
		await expect(
			resolveAdditionalData({ audience: 'editors', slug: 'hijacked' }, payload, 'my-guide')
		).rejects.toThrow(/my-guide.*slug/)
	})

	it('names every colliding field, not just the first', async () => {
		await expect(
			resolveAdditionalData({ targetFields: [], title: 'No' }, payload, 'my-guide')
		).rejects.toThrow(/targetFields, title/)
	})

	it('rejects a function that resolves to something other than an object', async () => {
		await expect(
			resolveAdditionalData(() => [] as unknown as Record<string, unknown>, payload, 'my-guide')
		).rejects.toThrow(/my-guide/)
	})
})
