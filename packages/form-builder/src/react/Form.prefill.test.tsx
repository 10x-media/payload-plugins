import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], id: number | string = 1): FormDocument => ({ id, fields })

describe('Form initialValues prefill', () => {
	it('seeds a text field value from initialValues', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]
		render(<Form form={doc(fields)} initialValues={{ name: 'Ada' }} onSubmit={vi.fn()} />)
		expect(screen.getByLabelText('Name')).toHaveValue('Ada')
	})

	it('prefill does not bypass validation: a required field still blocks submit', async () => {
		const onSubmit = vi.fn()
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name', label: 'Name', required: true },
		]
		render(<Form form={doc(fields)} initialValues={{}} onSubmit={onSubmit} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByRole('alert')).toHaveTextContent('This field is required')
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it('a prefilled value is submitted along with user input', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name', label: 'Name', required: true },
		]
		render(<Form form={doc(fields, 5)} initialValues={{ name: 'Ada' }} onSubmit={onSubmit} />)

		expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada')

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 5,
				values: [{ field: 'name', value: 'Ada' }],
			})
		})
	})

	it('when initialValues is absent, behavior is identical to before', () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)
		expect(screen.getByLabelText('Name')).toHaveValue('')
	})
})
