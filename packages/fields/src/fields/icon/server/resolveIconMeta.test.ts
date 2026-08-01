import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { IconAdapter, IconMeta } from '../../../types'
import { resolveIconMeta } from './resolveIconMeta'

const ctx = { payload: {} as Payload }

const makeAdapter = (
	slug: string,
	icons: IconMeta[],
	resolveMeta?: IconAdapter['resolveMeta']
): IconAdapter => ({
	slug,
	label: slug,
	loadManifest: () => Promise.resolve({ categories: [], icons }),
	Icon: `x#${slug}Icon`,
	Assets: `x#${slug}Assets`,
	resolveMeta,
	version: 1,
})

describe('resolveIconMeta', () => {
	it('reads the manifest index when the adapter offers no resolver', async () => {
		const adapter = makeAdapter('derived', [
			{ categories: [], label: 'Hungary', name: 'HUN', tags: [] },
		])
		await expect(resolveIconMeta(adapter, 'HUN', ctx)).resolves.toEqual({
			categories: [],
			label: 'Hungary',
			name: 'HUN',
			tags: [],
		})
	})

	it('resolves null for a name the manifest does not hold', async () => {
		const adapter = makeAdapter('absent', [{ categories: [], name: 'house', tags: [] }])
		await expect(resolveIconMeta(adapter, 'nope', ctx)).resolves.toBeNull()
	})

	// An adapter backed by a database answers one indexed query instead of
	// materialising a manifest, which is what keeps validation exact and cheap.
	it('prefers an adapter-supplied resolver and never loads the manifest', async () => {
		const loadManifest = vi.fn(() => Promise.resolve({ categories: [], icons: [] }))
		const adapter: IconAdapter = {
			slug: 'live',
			label: 'live',
			loadManifest,
			Icon: 'x#Icon',
			Assets: 'x#Assets',
			resolveMeta: async (name) =>
				name === 'fresh' ? { categories: [], label: 'Fresh', name, tags: [] } : null,
			version: 1,
		}
		await expect(resolveIconMeta(adapter, 'fresh', ctx)).resolves.toMatchObject({ label: 'Fresh' })
		await expect(resolveIconMeta(adapter, 'stale', ctx)).resolves.toBeNull()
		expect(loadManifest).not.toHaveBeenCalled()
	})

	it('passes the context through to an adapter-supplied resolver', async () => {
		const resolveMeta = vi.fn(async () => null)
		await resolveIconMeta(makeAdapter('ctx', [], resolveMeta), 'x', ctx)
		expect(resolveMeta).toHaveBeenCalledWith('x', ctx)
	})
})
