import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IconAdapter, IconLayer, IconManifest, IconMeta } from '../../../types'
import { invalidateLayerManifests } from './manifestCache'
import { loadLayeredManifest, resolveLayeredMeta } from './resolve'

const ctx = { payload: {} as Payload }

// Layer listings are cached process-wide by adapter slug and layer id, both of which
// these cases deliberately reuse. Clearing between cases keeps each one honest.
beforeEach(() => invalidateLayerManifests())

const icon = (name: string, extra: Partial<IconMeta> = {}): IconMeta => ({
	categories: [],
	tags: [],
	...extra,
	name,
})

const manifest = (icons: IconMeta[], categories: string[] = []): IconManifest => ({
	categories,
	icons,
})

const layer = (id: string, partial: Partial<IconLayer> = {}): IconLayer => ({
	id,
	loadManifest: async () => manifest([]),
	render: { Icon: 'x#Icon', type: 'component' },
	...partial,
})

const adapterWith = (layers: IconLayer[]): IconAdapter => ({
	slug: 'layered',
	label: 'Layered',
	layers,
	loadManifest: async () => manifest([]),
	Icon: 'x#Icon',
	Assets: 'x#Assets',
	version: 1,
})

describe('loadLayeredManifest', () => {
	it('merges layers with later ones winning by name', async () => {
		const adapter = adapterWith([
			layer('base', {
				loadManifest: async () => manifest([icon('HUN', { label: 'Hungary' }), icon('SUI')], ['a']),
			}),
			layer('override', {
				loadManifest: async () => manifest([icon('HUN', { label: 'Magyarorszag' })], ['b']),
			}),
		])
		const merged = await loadLayeredManifest(adapter, ctx)
		expect(merged.icons.map((entry) => entry.name).sort()).toEqual(['HUN', 'SUI'])
		expect(merged.icons.find((entry) => entry.name === 'HUN')?.label).toBe('Magyarorszag')
		expect(merged.categories).toEqual(['a', 'b'])
	})

	it('lets a later layer add names the base does not have', async () => {
		const adapter = adapterWith([
			layer('base', { loadManifest: async () => manifest([icon('SUI')]) }),
			layer('override', { loadManifest: async () => manifest([icon('ZZZ')]) }),
		])
		const merged = await loadLayeredManifest(adapter, ctx)
		expect(merged.icons.map((entry) => entry.name).sort()).toEqual(['SUI', 'ZZZ'])
	})

	it('falls back to the adapter manifest when no layers are declared', async () => {
		const adapter: IconAdapter = {
			slug: 'flat',
			label: 'Flat',
			loadManifest: async () => manifest([icon('house')], ['ui']),
			Icon: 'x#Icon',
			Assets: 'x#Assets',
			version: 1,
		}
		const merged = await loadLayeredManifest(adapter, ctx)
		expect(merged).toEqual(manifest([icon('house')], ['ui']))
	})

	it("caches a layer declaring 'forever' and reloads one declaring a ttl", async () => {
		const forever = vi.fn(async () => manifest([icon('a')]))
		const ttl = vi.fn(async () => manifest([icon('b')]))
		const adapter = adapterWith([
			layer('forever', { cache: 'forever', loadManifest: forever }),
			layer('ttl', { cache: { ttl: 0 }, loadManifest: ttl }),
		])
		await loadLayeredManifest(adapter, ctx)
		await loadLayeredManifest(adapter, ctx)
		expect(forever).toHaveBeenCalledTimes(1)
		expect(ttl).toHaveBeenCalledTimes(2)
	})

	// Slug and layer id are identical across tenants by construction, so without a
	// cacheKey a scoped layer would hand tenant A's library to tenant B.
	it('keeps scoped layers apart when the layer declares a cache key', async () => {
		const perTenant = vi.fn(async (context: { payload: Payload; tenant?: string }) =>
			manifest([icon(`${context.tenant}-only`)])
		)
		const adapter = adapterWith([
			layer('scoped', {
				cache: 'forever',
				cacheKey: (context) => String((context as { tenant?: string }).tenant ?? ''),
				loadManifest: (context) => perTenant(context as { payload: Payload; tenant?: string }),
			}),
		])
		const a = await loadLayeredManifest(adapter, { ...ctx, tenant: 'a' } as never)
		const b = await loadLayeredManifest(adapter, { ...ctx, tenant: 'b' } as never)
		expect(a.icons.map((entry) => entry.name)).toEqual(['a-only'])
		expect(b.icons.map((entry) => entry.name)).toEqual(['b-only'])
		expect(perTenant).toHaveBeenCalledTimes(2)
	})

	it('evicts a rejected layer load so the next call retries', async () => {
		let attempt = 0
		const loadManifest = vi.fn(async () => {
			attempt += 1
			if (attempt === 1) throw new Error('transient')
			return manifest([icon('recovered')])
		})
		const adapter = adapterWith([layer('flaky', { cache: 'forever', loadManifest })])
		await expect(loadLayeredManifest(adapter, ctx)).rejects.toThrow('transient')
		const merged = await loadLayeredManifest(adapter, ctx)
		expect(merged.icons.map((entry) => entry.name)).toEqual(['recovered'])
	})
})

describe('resolveLayeredMeta', () => {
	it('walks layers newest first and stops at the first hit', async () => {
		const baseResolve = vi.fn(async () => icon('HUN', { label: 'base' }))
		const topResolve = vi.fn(async () => icon('HUN', { label: 'top' }))
		const adapter = adapterWith([
			layer('base', { resolveMeta: baseResolve }),
			layer('override', { resolveMeta: topResolve }),
		])
		await expect(resolveLayeredMeta(adapter, 'HUN', ctx)).resolves.toMatchObject({ label: 'top' })
		expect(baseResolve).not.toHaveBeenCalled()
	})

	it('falls through to an older layer when the newer one misses', async () => {
		const adapter = adapterWith([
			layer('base', { resolveMeta: async () => icon('SUI', { label: 'base' }) }),
			layer('override', { resolveMeta: async () => null }),
		])
		await expect(resolveLayeredMeta(adapter, 'SUI', ctx)).resolves.toMatchObject({ label: 'base' })
	})

	it('resolves null when no layer has the name', async () => {
		const adapter = adapterWith([layer('only', { resolveMeta: async () => null })])
		await expect(resolveLayeredMeta(adapter, 'nope', ctx)).resolves.toBeNull()
	})

	it('reads a layer manifest when the layer offers no resolver', async () => {
		const adapter = adapterWith([
			layer('base', { loadManifest: async () => manifest([icon('house', { label: 'Home' })]) }),
		])
		await expect(resolveLayeredMeta(adapter, 'house', ctx)).resolves.toMatchObject({
			label: 'Home',
		})
	})

	// The footer case: eight icon fields on one document, eight distinct names. Memoisation
	// alone would still issue eight calls, so only batching collapses them.
	it('coalesces concurrent lookups into one batched call', async () => {
		const resolveMetaMany = vi.fn(async (names: string[]) => {
			const found = new Map<string, IconMeta>()
			for (const name of names) found.set(name, icon(name, { label: `L-${name}` }))
			return found
		})
		const adapter = adapterWith([layer('batched', { resolveMetaMany })])
		const names = ['HUN', 'SUI', 'CHN', 'FRA', 'GER', 'ITA', 'ESP', 'POR']
		const results = await Promise.all(names.map((name) => resolveLayeredMeta(adapter, name, ctx)))
		expect(results.map((entry) => entry?.label)).toEqual(names.map((name) => `L-${name}`))
		expect(resolveMetaMany).toHaveBeenCalledTimes(1)
		expect(resolveMetaMany.mock.calls[0]?.[0]?.slice().sort()).toEqual([...names].sort())
	})

	it('reports a miss for a name the batch does not return', async () => {
		const resolveMetaMany = vi.fn(async () => new Map<string, IconMeta>())
		const adapter = adapterWith([layer('batched', { resolveMetaMany })])
		await expect(resolveLayeredMeta(adapter, 'absent', ctx)).resolves.toBeNull()
	})

	it('falls back to per-name resolveMeta when a layer offers no batch form', async () => {
		const resolveMeta = vi.fn(async (name: string) => icon(name))
		const adapter = adapterWith([layer('single', { resolveMeta })])
		await Promise.all([
			resolveLayeredMeta(adapter, 'a', ctx),
			resolveLayeredMeta(adapter, 'b', ctx),
		])
		expect(resolveMeta).toHaveBeenCalledTimes(2)
	})
})
