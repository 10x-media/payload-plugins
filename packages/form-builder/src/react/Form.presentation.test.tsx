import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], overrides: Partial<FormDocument> = {}): FormDocument => ({
	id: 1,
	fields,
	...overrides,
})

const oneTextField: FormFieldInstance = { blockType: 'text', name: 'name', label: 'Name' }

const linearFields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{ blockType: 'text', name: 'last', label: 'Last' },
]
const linearFlow: FormFlow = {
	steps: [
		{ id: 's1', fields: ['first'], next: 's2' },
		{ id: 's2', fields: ['last'] },
	],
}

describe('Form presentations', () => {
	it('renders the page default with no dialog, like before', () => {
		const { container } = render(
			<Form form={doc([oneTextField])} onSubmit={vi.fn().mockResolvedValue({ ok: true })} />
		)
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(screen.getByLabelText('Name')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
		expect(container.querySelector('[data-fb-presentation="page"]')).not.toBeNull()
	})

	it('wraps the form in a dialog for a modal default', () => {
		render(
			<Form
				form={doc([oneTextField], { defaultPresentation: 'modal' })}
				onSubmit={vi.fn().mockResolvedValue({ ok: true })}
			/>
		)
		const dialog = screen.getByRole('dialog')
		expect(dialog).toHaveAttribute('aria-modal', 'true')
		expect(screen.getByLabelText('Name')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
	})

	it('lets the presentation prop override the stored default', () => {
		render(
			<Form
				form={doc([oneTextField], { defaultPresentation: 'page' })}
				presentation="modal"
				onSubmit={vi.fn().mockResolvedValue({ ok: true })}
			/>
		)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('fires onClose on Escape for an overlay', () => {
		const onClose = vi.fn()
		render(
			<Form
				form={doc([oneTextField], { defaultPresentation: 'modal' })}
				onClose={onClose}
				onSubmit={vi.fn().mockResolvedValue({ ok: true })}
			/>
		)
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onClose).toHaveBeenCalled()
	})

	it('closes on a successful submit when dismissOnSuccess is set', async () => {
		const onClose = vi.fn()
		render(
			<Form
				form={doc([oneTextField], { defaultPresentation: 'modal' })}
				onClose={onClose}
				onSubmit={vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => {
			expect(onClose).toHaveBeenCalled()
		})
	})

	it('renders multi-step controls inside a modal', () => {
		render(
			<Form
				form={doc(linearFields, { defaultPresentation: 'modal', flow: linearFlow })}
				onSubmit={vi.fn()}
			/>
		)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
	})

	it('renders a custom layout with an inline presentation and no dialog', () => {
		render(
			<Form form={doc([oneTextField])} presentation="inline" onSubmit={vi.fn()}>
				<div>custom</div>
			</Form>
		)
		expect(screen.getByText('custom')).toBeInTheDocument()
		expect(screen.queryByRole('dialog')).toBeNull()
	})
})
