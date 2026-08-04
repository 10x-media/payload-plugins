import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { uploadIconLayer } from './upload'

const payloadWith = (docs: Record<string, unknown>[]) => {
	const find = vi.fn(async () => ({ docs }))
	return { find: find as unknown as Payload['find'], spy: find }
}

const ctxWith = (docs: Record<string, unknown>[]) => {
	const { find, spy } = payloadWith(docs)
	return { ctx: { payload: { find } as unknown as Payload }, spy }
}

const base = { collection: 'icon-overrides' as never, resolveUrl: 'x#resolveUrl' }

describe('uploadIconLayer', () => {
	// url renders through <img>, which cannot execute script. svg inlines editor-written
	// markup into the admin, so it has to be chosen rather than inherited.
	it('renders through url by default', () => {
		expect(uploadIconLayer(base).render).toEqual({ resolve: 'x#resolveUrl', type: 'url' })
	})

	it('renders through svg only when asked', () => {
		const layer = uploadIconLayer({ ...base, loadSvgs: 'x#loadSvgs', render: 'svg' })
		expect(layer.render).toEqual({ load: 'x#loadSvgs', type: 'svg' })
	})

	it('refuses a strategy with no loader path rather than rendering nothing', () => {
		expect(() => uploadIconLayer({ collection: 'c' as never })).toThrow('resolveUrl')
		expect(() => uploadIconLayer({ collection: 'c' as never, render: 'svg' })).toThrow('loadSvgs')
	})

	// A listing that changes at runtime cannot default to 'forever'.
	it('defaults to a short ttl rather than caching forever', () => {
		expect(uploadIconLayer(base).cache).toEqual({ ttl: 30_000 })
	})

	it('maps documents onto manifest entries, carrying the label', async () => {
		const { ctx } = ctxWith([
			{ categories: ['flags'], label: 'Hungary', name: 'HUN', tags: ['hungary'] },
			{ name: 'SUI' },
		])
		const manifest = await uploadIconLayer(base).loadManifest(ctx)
		expect(manifest.icons).toEqual([
			{ categories: ['flags'], label: 'Hungary', name: 'HUN', tags: ['hungary'] },
			{ categories: [], name: 'SUI', tags: [] },
		])
		expect(manifest.categories).toEqual(['flags'])
	})

	it('skips a document with no usable name rather than emitting a broken entry', async () => {
		const { ctx } = ctxWith([{ name: '' }, { name: 'ok' }, {}])
		const manifest = await uploadIconLayer(base).loadManifest(ctx)
		expect(manifest.icons.map((icon) => icon.name)).toEqual(['ok'])
	})

	it('honours configured field names', async () => {
		const { ctx } = ctxWith([{ code: 'HUN', country: 'Hungary' }])
		const layer = uploadIconLayer({ ...base, labelField: 'country', nameField: 'code' })
		const manifest = await layer.loadManifest(ctx)
		expect(manifest.icons[0]).toMatchObject({ label: 'Hungary', name: 'HUN' })
	})

	// This is the gap-1 fix in miniature: an exact query, never a cached listing, so an icon
	// uploaded a moment ago validates immediately on every instance.
	it('resolves one name through an exact query', async () => {
		const { ctx, spy } = ctxWith([{ name: 'HUN' }])
		await uploadIconLayer(base).resolveMeta?.('HUN', ctx)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 1, where: { name: { equals: 'HUN' } } })
		)
	})

	it('resolves many names through a single in-clause', async () => {
		const { ctx, spy } = ctxWith([{ name: 'HUN' }, { name: 'SUI' }])
		const found = await uploadIconLayer(base).resolveMetaMany?.(['HUN', 'SUI', 'ZZZ'], ctx)
		expect(spy).toHaveBeenCalledTimes(1)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ where: { name: { in: ['HUN', 'SUI', 'ZZZ'] } } })
		)
		expect([...(found?.keys() ?? [])].sort()).toEqual(['HUN', 'SUI'])
	})

	it('ands a scoping where-clause into every lookup', async () => {
		const { ctx, spy } = ctxWith([])
		const layer = uploadIconLayer({ ...base, where: () => ({ tenant: { equals: 't1' } }) })
		await layer.resolveMeta?.('HUN', ctx)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { and: [{ tenant: { equals: 't1' } }, { name: { equals: 'HUN' } }] },
			})
		)
	})

	it('carries a supplied cache key so a scoped listing is not shared', () => {
		const layer = uploadIconLayer({ ...base, cacheKey: () => 't1' })
		expect(layer.cacheKey?.({ payload: {} as Payload })).toBe('t1')
	})
})
