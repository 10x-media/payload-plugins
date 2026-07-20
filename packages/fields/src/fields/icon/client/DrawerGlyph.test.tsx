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
})
