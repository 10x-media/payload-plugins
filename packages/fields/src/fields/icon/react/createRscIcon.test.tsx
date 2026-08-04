import { describe, expect, it, vi } from 'vitest'
import { createRscIcon } from './createRscIcon'
import type { IconRendererAdapter } from './types'

const fakeRenderer: IconRendererAdapter = {
	slug: 'fake',
	loadIcon: (name) =>
		Promise.resolve(
			name === 'known' ? (props) => <svg data-props={JSON.stringify(props)} /> : null
		),
}

describe('createRscIcon', () => {
	const Icon = createRscIcon({ adapters: [fakeRenderer] })

	it('renders null-ish fallback for empty values', async () => {
		const node = await Icon({ fallback: 'FB', icon: null })
		expect(node).toBe('FB')
	})

	it('resolves bare values against the default library and renders the component', async () => {
		const node = await Icon({ icon: 'known' })
		expect(node).not.toBeNull()
	})

	it('falls back for unknown names and unknown libraries', async () => {
		expect(await Icon({ fallback: 'FB', icon: 'fake:unknown' })).toBe('FB')
		expect(await Icon({ fallback: 'FB', icon: 'other:known' })).toBe('FB')
	})

	it('resolves a repeated value once', async () => {
		const loadIcon = vi.fn(async () => (props: Record<string, unknown>) => (
			<svg data-props={JSON.stringify(props)} />
		))
		const Cached = createRscIcon({ adapters: [{ loadIcon, slug: 'fake' }] })
		await Cached({ icon: 'fake:known' })
		await Cached({ icon: 'fake:known' })
		expect(loadIcon).toHaveBeenCalledTimes(1)
	})

	it('caches a resolved miss rather than re-asking the adapter', async () => {
		const loadIcon = vi.fn(async () => null)
		const Cached = createRscIcon({ adapters: [{ loadIcon, slug: 'fake' }] })
		expect(await Cached({ fallback: 'FB', icon: 'fake:missing' })).toBe('FB')
		expect(await Cached({ fallback: 'FB', icon: 'fake:missing' })).toBe('FB')
		expect(loadIcon).toHaveBeenCalledTimes(1)
	})

	// A transient failure must not poison an icon for the process lifetime. Same
	// reject-eviction the manifest cache already does; an HTTP-backed loadIcon is
	// precisely why this cache exists, so a network blip has to stay recoverable.
	it('evicts a rejected load so the next render retries', async () => {
		const loadIcon = vi
			.fn<IconRendererAdapter['loadIcon']>()
			.mockRejectedValueOnce(new Error('network blip'))
			.mockResolvedValueOnce(() => <svg />)
		const Cached = createRscIcon({ adapters: [{ loadIcon, slug: 'fake' }] })
		await expect(Cached({ icon: 'fake:known' })).rejects.toThrow('network blip')
		expect(await Cached({ icon: 'fake:known' })).not.toBeNull()
		expect(loadIcon).toHaveBeenCalledTimes(2)
	})
})
