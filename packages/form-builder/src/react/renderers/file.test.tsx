import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../translations/en'
import { makeTranslate } from '../../translations/makeTranslate'
import type { FieldRendererProps } from '../contract'
import { fileRenderer } from './file'

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

const stubUpload = (response: Partial<Response> & { json?: () => Promise<unknown> }) => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response as unknown as Response))
}

const pdf = () => new File(['data'], 'resume.pdf', { type: 'application/pdf' })

describe('file renderer', () => {
	it('renders a labeled file input', () => {
		const { container } = render(createElement(fileRenderer, props({})))
		expect(within(container).getByText('Resume')).toBeInTheDocument()
		const input = container.querySelector('input[type="file"]')
		expect(input).not.toBeNull()
		expect(input?.getAttribute('aria-describedby')).toBeTruthy()
	})

	it('sets the accept attribute from the field mimeTypes', () => {
		const { container } = render(
			createElement(
				fileRenderer,
				props({
					field: { blockType: 'file', name: 'resume', mimeTypes: ['application/pdf', 'image/*'] },
				})
			)
		)
		expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe(
			'application/pdf,image/*'
		)
	})

	it('uploads the selected file and calls onChange with the returned id', async () => {
		stubUpload({ ok: true, json: async () => ({ doc: { id: 'up1' } }) })
		const onChange = vi.fn()
		const { container } = render(createElement(fileRenderer, props({ onChange })))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(onChange).toHaveBeenCalledWith('up1'))
		expect(within(container).getByText('resume.pdf')).toBeInTheDocument()
	})

	it('shows an error and does not call onChange when the upload fails', async () => {
		stubUpload({ ok: false, status: 500, json: async () => ({}) })
		const onChange = vi.fn()
		const { container } = render(createElement(fileRenderer, props({ onChange })))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
		expect(onChange).not.toHaveBeenCalled()
	})

	it('clears the uploaded file', async () => {
		stubUpload({ ok: true, json: async () => ({ doc: { id: 'up1' } }) })
		const onChange = vi.fn()
		const { container } = render(createElement(fileRenderer, props({ onChange })))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(within(container).getByText('resume.pdf')).toBeInTheDocument())
		fireEvent.click(within(container).getByRole('button', { name: /remove/i }))
		expect(within(container).queryByText('resume.pdf')).toBeNull()
		expect(onChange).toHaveBeenLastCalledWith('')
	})

	it('disables the input when disabled', () => {
		const { container } = render(createElement(fileRenderer, props({ disabled: true })))
		expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true)
	})

	it('shows an attached indicator when the field already holds a value (recall/prefill)', () => {
		const { container } = render(createElement(fileRenderer, props({ value: 'existing-id' })))
		expect(within(container).getByText('Uploaded file')).toBeInTheDocument()
		expect(within(container).getByRole('button', { name: /remove/i })).toBeInTheDocument()
	})

	it('shows a hint with accepted types and the max size when configured', () => {
		const { container } = render(
			createElement(
				fileRenderer,
				props({
					field: {
						blockType: 'file',
						name: 'resume',
						mimeTypes: ['application/pdf'],
						maxSize: 2621440,
					},
					t: makeTranslate(en),
				})
			)
		)
		expect(
			within(container).getByText('Accepted: application/pdf · Max size: 2.5 MB')
		).toBeInTheDocument()
	})

	it('rejects an oversized file before uploading', async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				fileRenderer,
				props({
					field: { blockType: 'file', name: 'resume', maxSize: 1024 },
					onChange,
					t: makeTranslate(en),
				})
			)
		)
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		const big = new File([new Uint8Array(2048)], 'big.pdf', { type: 'application/pdf' })
		fireEvent.change(input, { target: { files: [big] } })
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
		expect(within(container).getByText('File is too large (max 1 KB)')).toBeInTheDocument()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(onChange).not.toHaveBeenCalled()
	})

	it('treats a zero max size as a real limit, matching the server', async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				fileRenderer,
				props({
					field: { blockType: 'file', name: 'resume', maxSize: 0 },
					onChange,
					t: makeTranslate(en),
				})
			)
		)
		expect(within(container).getByText('Max size: 0 B')).toBeInTheDocument()
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
		expect(within(container).getByText('File is too large (max 0 B)')).toBeInTheDocument()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(onChange).not.toHaveBeenCalled()
	})

	it('uploads a file within the max size and clears a previous size error', async () => {
		stubUpload({ ok: true, json: async () => ({ doc: { id: 'up3' } }) })
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				fileRenderer,
				props({
					field: { blockType: 'file', name: 'resume', maxSize: 1024 },
					onChange,
					t: makeTranslate(en),
				})
			)
		)
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		const big = new File([new Uint8Array(2048)], 'big.pdf', { type: 'application/pdf' })
		fireEvent.change(input, { target: { files: [big] } })
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(onChange).toHaveBeenCalledWith('up3'))
		expect(within(container).queryByRole('alert')).toBeNull()
	})

	it('re-attempts cleanly after a failed upload', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: async () => ({}),
			} as unknown as Response)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ doc: { id: 'up2' } }),
			} as unknown as Response)
		vi.stubGlobal('fetch', fetchMock)
		const onChange = vi.fn()
		const { container } = render(createElement(fileRenderer, props({ onChange })))
		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
		fireEvent.change(input, { target: { files: [pdf()] } })
		await waitFor(() => expect(onChange).toHaveBeenCalledWith('up2'))
		expect(within(container).queryByRole('alert')).toBeNull()
	})
})
