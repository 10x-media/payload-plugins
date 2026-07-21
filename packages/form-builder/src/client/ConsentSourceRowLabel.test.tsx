import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsentSourceRowLabel } from './ConsentSourceRowLabel'

const rowLabel = vi.hoisted(() => ({
	current: { data: {} as { name?: unknown }, rowNumber: 0 as number | undefined },
}))
vi.mock('@payloadcms/ui', () => ({ useRowLabel: () => rowLabel.current }))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string) => (key === 'formBuilder:consentSources.singular' ? 'Consent source' : key),
	}),
}))

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('ConsentSourceRowLabel', () => {
	it('shows the source name', () => {
		rowLabel.current = { data: { name: 'Privacy Policy' }, rowNumber: 0 }
		const { container } = render(<ConsentSourceRowLabel />)
		expect(container.textContent).toBe('Privacy Policy')
	})

	it('falls back to the singular label + number while unnamed', () => {
		rowLabel.current = { data: {}, rowNumber: 2 }
		const { container } = render(<ConsentSourceRowLabel />)
		expect(container.textContent).toBe('Consent source 03')
	})

	it('treats a blank name as unnamed', () => {
		rowLabel.current = { data: { name: '   ' }, rowNumber: 0 }
		const { container } = render(<ConsentSourceRowLabel />)
		expect(container.textContent).toBe('Consent source 01')
	})
})
