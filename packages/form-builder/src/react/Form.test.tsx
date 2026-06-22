import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEventSink } from '../events/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'
import { useField } from './useField'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], id: number | string = 1): FormDocument => ({ id, fields })

describe('Form', () => {
	it('hides a field until its visibleWhen condition is met', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'a', label: 'A' },
			{ blockType: 'text', name: 'b', label: 'B', visibleWhen: { a: { equals: 'go' } } },
		]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)

		expect(screen.getByLabelText('A')).toBeInTheDocument()
		expect(screen.queryByLabelText('B')).not.toBeInTheDocument()

		fireEvent.change(screen.getByLabelText('A'), { target: { value: 'go' } })

		expect(await screen.findByLabelText('B')).toBeInTheDocument()
	})

	it('blocks submit and shows the error when a required field is empty', async () => {
		const onSubmit = vi.fn()
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name', label: 'Name', required: true },
		]
		render(<Form form={doc(fields)} onSubmit={onSubmit} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByRole('alert')).toHaveTextContent('formBuilder:validation.required')
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it('submits valid values and renders success on ok', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const onSuccess = vi.fn()
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name', label: 'Name', required: true },
		]
		render(<Form form={doc(fields, 7)} onSubmit={onSubmit} onSuccess={onSuccess} />)

		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByRole('status')).toHaveTextContent('Thank you.')
		expect(onSubmit).toHaveBeenCalledWith({
			formId: 7,
			values: [{ field: 'name', value: 'Ada' }],
		})
		expect(onSuccess).toHaveBeenCalledWith('1')
	})

	it('surfaces a per-field error returned by the submit handler', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: false, fieldErrors: { name: ['Taken'] } })
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name', label: 'Name', required: true },
		]
		render(<Form form={doc(fields)} onSubmit={onSubmit} />)

		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByText('Taken')).toBeInTheDocument()
	})

	it('emits form.viewed on mount and submission.created on success', async () => {
		const emit = vi.fn()
		const events: FormEventSink = { emit }
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '9' })
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]
		render(<Form form={doc(fields)} onSubmit={onSubmit} events={events} />)

		await waitFor(() => {
			expect(emit).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'form.viewed', formId: '1' })
			)
		})

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'submission.created',
					formId: '1',
					submissionId: '9',
				})
			)
		})
		const viewed = emit.mock.calls.find(([e]) => e.type === 'form.viewed')?.[0]
		expect(typeof viewed.at).toBe('string')
	})

	it('renders custom children bound via useField and submits their values', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '3' })
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]
		const Custom = () => {
			const { value, setValue, onBlur } = useField<string>('name')
			return (
				<input
					aria-label="custom"
					value={value ?? ''}
					onChange={(event) => setValue(event.target.value)}
					onBlur={onBlur}
				/>
			)
		}
		render(
			<Form form={doc(fields, 5)} onSubmit={onSubmit}>
				<Custom />
				<button type="submit">Send</button>
			</Form>
		)

		fireEvent.change(screen.getByLabelText('custom'), { target: { value: 'Grace' } })
		fireEvent.click(screen.getByRole('button', { name: 'Send' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 5,
				values: [{ field: 'name', value: 'Grace' }],
			})
		})
	})
})
