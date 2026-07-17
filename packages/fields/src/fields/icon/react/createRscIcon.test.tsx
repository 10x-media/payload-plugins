import { describe, expect, it } from 'vitest'
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
})
