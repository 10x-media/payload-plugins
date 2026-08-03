import type { PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IconAdapter, IconLayer } from '../../../types'
import { invalidateLayerManifests } from '../layers/manifestCache'
import { createIconManifestHandler, ICON_MANIFEST_PATH } from './endpoint'

beforeEach(() => invalidateLayerManifests())

const layer = (id: string, names: string[], extra: Partial<IconLayer> = {}): IconLayer => ({
	id,
	loadManifest: async () => ({
		categories: [],
		icons: names.map((name) => ({ categories: [], name, tags: [] })),
	}),
	render: { Icon: 'x#Icon', type: 'component' },
	...extra,
})

const adapter = (slug: string, layers: IconLayer[]): IconAdapter => ({
	slug,
	label: slug,
	layers,
	loadManifest: async () => ({ categories: [], icons: [] }),
	Icon: 'x#Icon',
	Assets: 'x#Assets',
	version: 1,
})

const request = (slug: string, user: unknown = { id: 'u1' }): PayloadRequest =>
	({
		payload: { config: {} },
		routeParams: { slug },
		user,
	}) as unknown as PayloadRequest

describe('icon manifest endpoint', () => {
	it('is mounted under a namespaced path', () => {
		expect(ICON_MANIFEST_PATH).toBe('/10x-fields/icon-manifest/:slug')
	})

	// The drawer is admin-only. An unauthenticated caller must not be able to enumerate a
	// library, which on an upload-backed layer means enumerating uploaded media.
	it('refuses an unauthenticated caller', async () => {
		const handler = createIconManifestHandler({
			adapters: [adapter('flag', [layer('base', ['HUN'])])],
		})
		const response = await handler(request('flag', null))
		expect(response.status).toBe(403)
	})

	it('serves the merged manifest for an available library', async () => {
		const handler = createIconManifestHandler({
			adapters: [adapter('flag', [layer('base', ['HUN']), layer('override', ['SUI'])])],
			resolveAvailable: () => ['flag'],
		})
		const response = await handler(request('flag'))
		expect(response.status).toBe(200)
		const body = (await response.json()) as { icons: { name: string }[] }
		expect(body.icons.map((icon) => icon.name).sort()).toEqual(['HUN', 'SUI'])
	})

	it('404s an unknown slug', async () => {
		const handler = createIconManifestHandler({ adapters: [] })
		expect((await handler(request('nope'))).status).toBe(404)
	})

	// Availability is how a tenant is scoped to its own libraries everywhere else; the
	// endpoint must not be the one place that bypasses it.
	it('refuses a library the caller may not select', async () => {
		const handler = createIconManifestHandler({
			adapters: [adapter('flag', [layer('base', ['HUN'])])],
			resolveAvailable: () => [],
		})
		expect((await handler(request('flag'))).status).toBe(403)
	})

	// alwaysAvailable is unioned in everywhere else, so a globally offered library would
	// otherwise be pickable in the field and unreachable through the endpoint.
	it('serves a library offered only through alwaysAvailable', async () => {
		const handler = createIconManifestHandler({
			adapters: [adapter('brand', [layer('base', ['logo'])])],
			alwaysAvailable: ['brand'],
			resolveAvailable: () => [],
		})
		expect((await handler(request('brand'))).status).toBe(200)
	})

	it('never lets a browser cache a library that can change at runtime', async () => {
		const handler = createIconManifestHandler({
			adapters: [adapter('flag', [layer('base', ['HUN'])])],
			resolveAvailable: () => ['flag'],
		})
		const response = await handler(request('flag'))
		expect(response.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it('reports a layer failure as a server error rather than an empty library', async () => {
		const broken = layer('broken', [])
		broken.loadManifest = async () => {
			throw new Error('database down')
		}
		const handler = createIconManifestHandler({
			adapters: [adapter('flag', [broken])],
			resolveAvailable: () => ['flag'],
		})
		const response = await handler(request('flag'))
		expect(response.status).toBe(500)
	})

	it('passes the request through to the layer as context', async () => {
		const loadManifest = vi.fn(async () => ({ categories: [], icons: [] }))
		const handler = createIconManifestHandler({
			adapters: [adapter('flag', [layer('base', [], { loadManifest })])],
			resolveAvailable: () => ['flag'],
		})
		const req = request('flag')
		await handler(req)
		expect(loadManifest).toHaveBeenCalledWith(expect.objectContaining({ req }))
	})
})
