// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', () => ({
	useConfig: () => ({ config: { routes: { api: '/api' }, serverURL: 'https://cms.example.com' } }),
}))

const { CountryFlag } = await import('./CountryFlag')

const flagImage = (container: HTMLElement): HTMLImageElement => {
	const image = container.querySelector('img')
	if (!image) throw new Error('no flag image was rendered')
	return image
}

describe('CountryFlag', () => {
	afterEach(cleanup)

	it('points svg artwork at the app flags endpoint, so the bundle carries none', () => {
		const { container } = render(<CountryFlag code="DE" mode="svg" />)
		expect(flagImage(container).getAttribute('src')).toBe(
			'https://cms.example.com/api/10x-fields/flags/de.svg'
		)
	})

	it('loads svg artwork lazily, so a long list fetches only what is on screen', () => {
		const { container } = render(<CountryFlag code="DE" mode="svg" />)
		const image = flagImage(container)
		expect(image.getAttribute('loading')).toBe('lazy')
		expect(image.getAttribute('decoding')).toBe('async')
	})

	it('keeps svg artwork out of the accessibility tree, the row text names the country', () => {
		const { container } = render(<CountryFlag code="DE" mode="svg" />)
		const image = flagImage(container)
		expect(image.getAttribute('alt')).toBe('')
		expect(image.getAttribute('aria-hidden')).toBe('true')
	})

	it('keeps a failed flag in the layout instead of unmounting it', () => {
		const { container } = render(<CountryFlag code="DE" mode="svg" />)
		const image = flagImage(container)
		fireEvent.error(image)
		expect(container.querySelector('img')).toBe(image)
		expect(image.style.visibility).toBe('hidden')
	})

	it('retries once the row is reused for a different country', () => {
		const { container, rerender } = render(<CountryFlag code="DE" mode="svg" />)
		fireEvent.error(flagImage(container))
		rerender(<CountryFlag code="FR" mode="svg" />)
		const image = flagImage(container)
		expect(image.getAttribute('src')).toBe('https://cms.example.com/api/10x-fields/flags/fr.svg')
		expect(image.style.visibility).toBe('')
	})

	it('renders the regional indicator pair in emoji mode and requests no artwork', () => {
		const { container } = render(<CountryFlag code="DE" mode="emoji" />)
		expect(container.querySelector('img')).toBeNull()
		expect(container.textContent).toBe(String.fromCodePoint(0x1f1e9, 0x1f1ea))
	})

	it('renders nothing at all in none mode', () => {
		const { container } = render(<CountryFlag code="DE" mode="none" />)
		expect(container.querySelector('img')).toBeNull()
		expect(container.textContent).toBe('')
	})
})
