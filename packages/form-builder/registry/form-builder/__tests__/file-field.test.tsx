import type { FieldRendererProps } from '@10x-media/form-builder/react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileField } from '../fields/file-field'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const props = (
	overrides: Partial<FieldRendererProps<string | number>>
): FieldRendererProps<string | number> => ({
	field: { blockType: 'file', name: 'resume', label: 'Resume' },
	id: 'x',
	name: 'resume',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

const pdf = () => new File(['data'], 'resume.pdf', { type: 'application/pdf' })

describe('shadcn file field', () => {
	it('renders a labeled file input with the accept hint', () => {
		const { container } = render(
			createElement(
				fileField,
				props({
					field: {
						blockType: 'file',
						name: 'resume',
						label: 'Resume',
						mimeTypes: ['application/pdf'],
					},
				})
			)
		)
		expect(within(container).getByText('Resume')).toBeInTheDocument()
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		expect(input.getAttribute('accept')).toBe('application/pdf')
	})

	it('uploads the file and calls onChange with the returned id', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ doc: { id: 'up1' } }),
			} as unknown as Response)
		)
		const onChange = vi.fn()
		const { container } = render(createElement(fileField, props({ onChange })))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(onChange).toHaveBeenCalledWith('up1'))
		expect(within(container).getByText('resume.pdf')).toBeInTheDocument()
	})

	it('shows an error when the upload fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				json: async () => ({}),
			} as unknown as Response)
		)
		const { container } = render(createElement(fileField, props({})))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
	})
})
