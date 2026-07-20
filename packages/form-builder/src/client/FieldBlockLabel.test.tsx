import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldBlockLabel } from './FieldBlockLabel'

const rowLabel = vi.hoisted(() => ({
	current: { data: {} as { label?: unknown }, rowNumber: 0 as number | undefined },
}))

vi.mock('@payloadcms/ui', () => ({
	useRowLabel: () => rowLabel.current,
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string) => ({ 'formBuilder:fieldType.text': 'Text' })[key] ?? key,
	}),
}))

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('FieldBlockLabel', () => {
	it('shows the field label alongside the numbered type label', () => {
		rowLabel.current = { data: { label: 'Full name' }, rowNumber: 0 }
		const { container } = render(<FieldBlockLabel typeLabelKey="formBuilder:fieldType.text" />)
		expect(container.textContent).toContain('01 Text')
		expect(container.textContent).toContain('Full name')
	})

	it('falls back to the type label while the field is unnamed, numbering from the row', () => {
		rowLabel.current = { data: {}, rowNumber: 2 }
		const { container } = render(<FieldBlockLabel typeLabelKey="formBuilder:fieldType.text" />)
		expect(container.textContent).toBe('03 Text')
	})

	it('treats a blank label as unnamed', () => {
		rowLabel.current = { data: { label: '   ' }, rowNumber: 0 }
		const { container } = render(<FieldBlockLabel typeLabelKey="formBuilder:fieldType.text" />)
		expect(container.textContent).toBe('01 Text')
	})
})
