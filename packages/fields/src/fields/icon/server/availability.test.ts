import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { IconAdapter, IconAvailabilityResolver } from '../../../types'
import { resolveAvailableLibraries, unionAlwaysAvailable } from './availability'

const adapter = (slug: string): IconAdapter => ({
	slug,
	label: slug,
	loadManifest: () => Promise.resolve({ categories: [], icons: [] }),
	Icon: `x#${slug}Icon`,
	Assets: `x#${slug}Assets`,
	version: 1,
})

const adapters = [adapter('lucide'), adapter('radix'), adapter('tabler')]

const makeReq = (): { req: PayloadRequest; error: ReturnType<typeof vi.fn> } => {
	const error = vi.fn()
	return { req: { payload: { logger: { error } } } as unknown as PayloadRequest, error }
}

describe('resolveAvailableLibraries', () => {
	it('returns all registered slugs when no resolver is given', async () => {
		const { req } = makeReq()
		expect(await resolveAvailableLibraries({ adapters, req })).toEqual([
			'lucide',
			'radix',
			'tabler',
		])
	})

	it('filters to the resolver subset intersected with registered adapters', async () => {
		const { req } = makeReq()
		const resolver: IconAvailabilityResolver = () => ['radix', 'unregistered']
		expect(await resolveAvailableLibraries({ adapters, req, resolver })).toEqual(['radix'])
	})

	it('degrades to all registered libraries and logs when the resolver throws', async () => {
		const { req, error } = makeReq()
		const resolver: IconAvailabilityResolver = () => {
			throw new Error('tenant lookup failed')
		}
		expect(await resolveAvailableLibraries({ adapters, req, resolver })).toEqual([
			'lucide',
			'radix',
			'tabler',
		])
		expect(error).toHaveBeenCalledTimes(1)
	})

	it('does not cache the rejection: fields sharing a throwing resolver each get all-registered and it logs once', async () => {
		const { req, error } = makeReq()
		const resolver: IconAvailabilityResolver = () => Promise.reject(new Error('boom'))
		const first = await resolveAvailableLibraries({ adapters, req, resolver })
		const second = await resolveAvailableLibraries({ adapters, req, resolver })
		expect(first).toEqual(['lucide', 'radix', 'tabler'])
		expect(second).toEqual(['lucide', 'radix', 'tabler'])
		// The memo dedupes the resolver call for the request, so exactly one log fires.
		expect(error).toHaveBeenCalledTimes(1)
	})

	it('unions alwaysAvailable with the resolver subset, ordered by adapter registration', async () => {
		const { req } = makeReq()
		const resolver: IconAvailabilityResolver = () => ['tabler']
		// Forced radix + resolved tabler; the result is registration order (radix before
		// tabler), not the input order of either list.
		expect(
			await resolveAvailableLibraries({ adapters, alwaysAvailable: ['radix'], req, resolver })
		).toEqual(['radix', 'tabler'])
	})

	it('forces an alwaysAvailable library the resolver explicitly excludes', async () => {
		const { req } = makeReq()
		const resolver: IconAvailabilityResolver = () => ['lucide']
		expect(
			await resolveAvailableLibraries({ adapters, alwaysAvailable: ['radix'], req, resolver })
		).toEqual(['lucide', 'radix'])
	})

	it('a throwing resolver still fails open to all registered, a superset of the forced set', async () => {
		const { req, error } = makeReq()
		const resolver: IconAvailabilityResolver = () => {
			throw new Error('tenant lookup failed')
		}
		expect(
			await resolveAvailableLibraries({ adapters, alwaysAvailable: ['radix'], req, resolver })
		).toEqual(['lucide', 'radix', 'tabler'])
		expect(error).toHaveBeenCalledTimes(1)
	})

	it('drops an alwaysAvailable slug that has no registered adapter', async () => {
		const { req } = makeReq()
		const resolver: IconAvailabilityResolver = () => ['lucide']
		expect(
			await resolveAvailableLibraries({
				adapters,
				alwaysAvailable: ['not-registered'],
				req,
				resolver,
			})
		).toEqual(['lucide'])
	})
})

describe('unionAlwaysAvailable', () => {
	it('unions per-field with global and dedupes', () => {
		expect(unionAlwaysAvailable(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
	})

	it('applies global when there is no per-field value', () => {
		expect(unionAlwaysAvailable(undefined, ['social'])).toEqual(['social'])
	})

	it('applies per-field when there is no global value', () => {
		expect(unionAlwaysAvailable(['social'], undefined)).toEqual(['social'])
	})

	it('is empty when neither is set', () => {
		expect(unionAlwaysAvailable(undefined, undefined)).toEqual([])
	})
})
