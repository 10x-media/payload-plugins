import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { declarationsOf } from '../testing/stylesheet'
import { CountryFlag, CountryFlagImg } from './CountryFlag'

vi.mock('@payloadcms/ui', () => ({
	useConfig: () => ({
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
	}),
}))

afterEach(cleanup)

const flag = (container: HTMLElement): HTMLImageElement => {
	const img = container.querySelector('img')
	if (!img) throw new Error('no flag rendered')
	return img
}

describe('CountryFlag', () => {
	it('points at the install own flag route, lower-cased and suffixed', () => {
		const { container } = render(<CountryFlag code="DE" />)
		expect(flag(container).getAttribute('src')).toBe('/api/_x/flags/de.svg')
	})

	it('keeps the flag out of the accessibility tree and off the critical path', () => {
		const img = flag(render(<CountryFlag code="DE" />).container)
		expect(img.getAttribute('alt')).toBe('')
		expect(img.getAttribute('aria-hidden')).toBe('true')
		expect(img.getAttribute('loading')).toBe('lazy')
		expect(img.getAttribute('decoding')).toBe('async')
		expect(img.getAttribute('width')).toBe('20')
		expect(img.getAttribute('height')).toBe('15')
	})

	it('hides a flag that fails to load without collapsing its box', () => {
		const { container } = render(<CountryFlagImg src="/api/_x/flags/zz.svg" />)
		const img = flag(container)
		expect(img.classList.contains('analytics-flag--failed')).toBe(false)
		fireEvent.error(img)
		expect(flag(container).classList.contains('analytics-flag--failed')).toBe(true)
		expect(declarationsOf('.analytics-flag--failed')).toEqual({ visibility: 'hidden' })
		// 3x2, the aspect ratio the served artwork is drawn at, so nothing is squashed.
		expect(declarationsOf('.analytics-flag')).toMatchObject({ width: '20px', height: '15px' })
	})

	it('gives the next country its own attempt rather than the last one failure', () => {
		const { container, rerender } = render(<CountryFlagImg src="/api/_x/flags/zz.svg" />)
		fireEvent.error(flag(container))
		rerender(<CountryFlagImg src="/api/_x/flags/de.svg" />)
		expect(flag(container).classList.contains('analytics-flag--failed')).toBe(false)
	})
})
