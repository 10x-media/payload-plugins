// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createIcon } from './createIcon'
import type { IconRendererAdapter, IconRenderProps } from './types'

const Glyph = (props: IconRenderProps) => <svg data-testid="glyph" {...props} />

const rendererFor = (loadIcon: IconRendererAdapter['loadIcon']): IconRendererAdapter => ({
	loadIcon,
	slug: 'fake',
})

/**
 * Flushes the lazy resolution through React. Suspense shows `fallback` while
 * loading too, so every assertion below must run after this settles or it
 * cannot tell the loading state from the resolved-to-missing state. That
 * ambiguity is exactly why the defect survived: a snapshot taken mid-suspense
 * passes either way.
 */
const settle = async (): Promise<void> => {
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

describe('createIcon', () => {
	it('renders the glyph and not the fallback once a known icon resolves', async () => {
		const Icon = createIcon({ adapters: [rendererFor(async () => Glyph)] })
		render(<Icon fallback={<span>FB</span>} icon="fake:known" />)
		await settle()
		expect(screen.queryByTestId('glyph')).not.toBeNull()
		expect(screen.queryByText('FB')).toBeNull()
	})

	it('keeps the caller fallback after loadIcon resolves null', async () => {
		const Icon = createIcon({ adapters: [rendererFor(async () => null)] })
		render(<Icon fallback={<span>FB</span>} icon="fake:missing" />)
		await settle()
		expect(screen.queryByText('FB')).not.toBeNull()
	})

	it('renders nothing for an unresolvable icon when no fallback is given', async () => {
		const Icon = createIcon({ adapters: [rendererFor(async () => null)] })
		const { container } = render(<Icon icon="fake:missing" />)
		await settle()
		expect(container.textContent).toBe('')
	})

	it('loads a repeated value once, so the cached lazy survives the fallback fix', async () => {
		const loadIcon = vi.fn(async () => Glyph)
		const Icon = createIcon({ adapters: [rendererFor(loadIcon)] })
		render(
			<>
				<Icon icon="fake:known" />
				<Icon icon="fake:known" />
			</>
		)
		await settle()
		expect(loadIcon).toHaveBeenCalledTimes(1)
	})

	it('honours a per-call fallback, so two callers of one cached icon differ', async () => {
		const Icon = createIcon({ adapters: [rendererFor(async () => null)] })
		render(
			<>
				<Icon fallback={<span>FIRST</span>} icon="fake:missing" />
				<Icon fallback={<span>SECOND</span>} icon="fake:missing" />
			</>
		)
		await settle()
		expect(screen.queryByText('FIRST')).not.toBeNull()
		expect(screen.queryByText('SECOND')).not.toBeNull()
	})
})
