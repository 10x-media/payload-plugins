import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const lexical = (text: string) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
	},
})

const doc = (fields: FormFieldInstance[], extra?: Partial<FormDocument>): FormDocument => ({
	id: 1,
	fields,
	multistep: false,
	pollEnabled: false,
	...extra,
})

describe('Form with a nameless message block', () => {
	const fields: FormFieldInstance[] = [
		{ blockType: 'text', name: 'first', label: 'First' },
		{
			blockType: 'message',
			id: 'row-note',
			required: true,
			content: lexical('Between the fields'),
		},
		{ blockType: 'text', name: 'last', label: 'Last' },
	]

	it('renders the message inline between the fields and submits only the text answers', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc(fields)} onSubmit={onSubmit} />)

		expect(screen.getByText('Between the fields')).toBeInTheDocument()

		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'a' } })
		fireEvent.change(screen.getByLabelText('Last'), { target: { value: 'b' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 1,
				values: [
					{ field: 'first', value: 'a' },
					{ field: 'last', value: 'b' },
				],
			})
		})
	})

	it('renders multiple nameless messages, each keyed by its own row id', () => {
		const two: FormFieldInstance[] = [
			{ blockType: 'message', id: 'row-1', content: lexical('First note') },
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'message', id: 'row-2', content: lexical('Second note') },
		]
		render(<Form form={doc(two)} onSubmit={vi.fn()} />)
		expect(screen.getByText('First note')).toBeInTheDocument()
		expect(screen.getByText('Second note')).toBeInTheDocument()
	})

	it('keeps the message rendered while answers change (stable row-id key, no state binding)', () => {
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'x' } })
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'y' } })
		expect(screen.getByText('Between the fields')).toBeInTheDocument()
	})

	it('ignores required on a message block: submit is never blocked by it', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc(fields)} onSubmit={onSubmit} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalled()
		})
	})

	it('respects visibleWhen on a message block (programmatic docs)', () => {
		const conditional: FormFieldInstance[] = [
			{ blockType: 'text', name: 'a', label: 'A' },
			{
				blockType: 'message',
				id: 'row-note',
				content: lexical('Only when go'),
				visibleWhen: { a: { equals: 'go' } },
			},
		]
		render(<Form form={doc(conditional)} onSubmit={vi.fn()} />)
		expect(screen.queryByText('Only when go')).not.toBeInTheDocument()
		fireEvent.change(screen.getByLabelText('A'), { target: { value: 'go' } })
		expect(screen.getByText('Only when go')).toBeInTheDocument()
	})

	it('still renders a legacy named message row (name unused)', () => {
		const legacy: FormFieldInstance[] = [
			{ blockType: 'message', name: 'note', content: lexical('Legacy note') },
			{ blockType: 'text', name: 'first', label: 'First' },
		]
		render(<Form form={doc(legacy)} onSubmit={vi.fn()} />)
		expect(screen.getByText('Legacy note')).toBeInTheDocument()
	})
})

describe('Form response settings', () => {
	const nameField: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]

	it('renders the rich response message with recall in the status node on success', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const form = doc(nameField, {
			response: { type: 'message', message: lexical('Thanks {{name}}!') },
		})
		render(<Form form={form} onSubmit={onSubmit} />)

		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		const status = await screen.findByRole('status')
		expect(status.innerHTML).toBe('<p>Thanks Ada!</p>')
	})

	it('falls back to successMessage when the response has no message', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const form = doc(nameField, { response: { type: 'message' } })
		render(<Form form={form} onSubmit={onSubmit} successMessage="Plain thanks" />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Plain thanks')
	})

	it('redirects via window.location.assign after a successful submit', async () => {
		const assign = vi.fn()
		const originalLocation = window.location
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: { ...originalLocation, assign },
		})
		try {
			const onSubmit = vi.fn().mockResolvedValue({ ok: true })
			const form = doc(nameField, {
				response: { type: 'redirect', redirect: { url: 'https://example.com/thanks' } },
			})
			render(<Form form={form} onSubmit={onSubmit} />)

			fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

			await waitFor(() => {
				expect(assign).toHaveBeenCalledWith('https://example.com/thanks')
			})
		} finally {
			Object.defineProperty(window, 'location', {
				configurable: true,
				value: originalLocation,
			})
		}
	})

	it('does not redirect when type is message', async () => {
		const assign = vi.fn()
		const originalLocation = window.location
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: { ...originalLocation, assign },
		})
		try {
			const onSubmit = vi.fn().mockResolvedValue({ ok: true })
			const form = doc(nameField, {
				response: {
					type: 'message',
					message: lexical('Done'),
					redirect: { url: 'https://example.com/nope' },
				},
			})
			render(<Form form={form} onSubmit={onSubmit} />)

			fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

			await screen.findByRole('status')
			expect(assign).not.toHaveBeenCalled()
		} finally {
			Object.defineProperty(window, 'location', {
				configurable: true,
				value: originalLocation,
			})
		}
	})
})
