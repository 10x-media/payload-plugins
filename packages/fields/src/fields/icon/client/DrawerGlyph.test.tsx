// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IconNode } from '../../../types'
import { DrawerGlyph } from './DrawerGlyph'

// Real multi-path glyph: four <path> nodes sharing the same tag, the exact shape
// that a tag-derived key would collide on. Keys must stay unique per node.
const multiPath: IconNode[] = [
	['path', { d: 'm14 12 4 4 4-4' }],
	['path', { d: 'M18 16V7' }],
	['path', { d: 'm2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16' }],
	['path', { d: 'M3.304 13h6.392' }],
]

describe('DrawerGlyph', () => {
	afterEach(() => vi.restoreAllMocks())

	it('renders every node without duplicate-key warnings', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const { container } = render(<DrawerGlyph nodes={multiPath} size={24} />)
		const svg = container.querySelector('svg')
		expect(svg?.querySelectorAll('path')).toHaveLength(multiPath.length)
		const sameKeyWarning = errorSpy.mock.calls.some((call) => String(call[0]).includes('same key'))
		expect(sameKeyWarning).toBe(false)
	})

	// Defaults must equal the constants the drawer hardcoded before layers existed, or
	// every lucide and tabler glyph shifts at once.
	it('draws on the lucide outline canvas when the layer declares nothing', () => {
		const { container } = render(<DrawerGlyph nodes={[['path', { d: 'M0 0' }]]} size={24} />)
		const svg = container.querySelector('svg')
		expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
		expect(svg?.getAttribute('fill')).toBe('none')
		expect(svg?.getAttribute('stroke')).toBe('currentColor')
		expect(svg?.getAttribute('stroke-width')).toBe('2')
	})

	it('honours a layer-declared canvas, so a filled 15x15 set renders correctly', () => {
		const { container } = render(
			<DrawerGlyph
				canvas={{ fill: 'currentColor', stroke: 'none', strokeWidth: 0, viewBox: '0 0 15 15' }}
				nodes={[['path', { d: 'M0 0' }]]}
				size={24}
			/>
		)
		const svg = container.querySelector('svg')
		expect(svg?.getAttribute('viewBox')).toBe('0 0 15 15')
		expect(svg?.getAttribute('fill')).toBe('currentColor')
		expect(svg?.getAttribute('stroke')).toBe('none')
	})

	it('renders nested children, which a flat node list could not express', () => {
		const { container } = render(
			<DrawerGlyph
				nodes={[['g', { transform: 'scale(2)' }, [['circle', { cx: '1', cy: '1', r: '1' }]]]]}
				size={24}
			/>
		)
		const circle = container.querySelector('g > circle')
		expect(circle?.getAttribute('r')).toBe('1')
	})
})
