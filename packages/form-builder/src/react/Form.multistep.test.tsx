import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEventSink } from '../events/types'
import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (
	fields: FormFieldInstance[],
	flow?: FormFlow,
	id: number | string = 1
): FormDocument => ({
	id,
	fields,
	flow,
})

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

const branchingFields: FormFieldInstance[] = [
	{
		blockType: 'select',
		name: 'plan',
		label: 'Plan',
		options: [
			{ label: 'Free', value: 'free' },
			{ label: 'Pro', value: 'pro' },
		],
	},
	{ blockType: 'text', name: 'basicInfo', label: 'Basic info' },
	{ blockType: 'text', name: 'proInfo', label: 'Pro info' },
]
const branchingFlow: FormFlow = {
	steps: [
		{
			id: 'choose',
			fields: ['plan'],
			transitions: [{ when: { plan: { equals: 'pro' } }, to: 'pro' }],
			next: 'basic',
		},
		{ id: 'basic', fields: ['basicInfo'] },
		{ id: 'pro', fields: ['proInfo'] },
	],
}

describe('Form multi-step flow', () => {
	it('renders only the current step, advances and returns with values preserved, then submits', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		render(<Form form={doc(linearFields, linearFlow)} onSubmit={onSubmit} />)

		expect(screen.getByLabelText('First')).toBeInTheDocument()
		expect(screen.queryByLabelText('Last')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()

		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByLabelText('Last')).toBeInTheDocument()
		expect(screen.queryByLabelText('First')).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Back' }))
		expect(await screen.findByLabelText('First')).toHaveValue('Ada')

		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 1,
				values: [{ field: 'first', value: 'Ada' }],
			})
		})
	})

	it('blocks advancing when a required field in the step is empty', async () => {
		const onSubmit = vi.fn()
		const requiredFields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First', required: true },
			{ blockType: 'text', name: 'last', label: 'Last' },
		]
		render(<Form form={doc(requiredFields, linearFlow)} onSubmit={onSubmit} />)
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('formBuilder:validation.required')
		expect(screen.queryByLabelText('Last')).not.toBeInTheDocument()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it('follows a conditional transition when its condition matches', async () => {
		render(<Form form={doc(branchingFields, branchingFlow)} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'pro' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('Pro info')).toBeInTheDocument()
		expect(screen.queryByLabelText('Basic info')).not.toBeInTheDocument()
	})

	it('takes the default next when no transition matches', async () => {
		render(<Form form={doc(branchingFields, branchingFlow)} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'free' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('Basic info')).toBeInTheDocument()
		expect(screen.queryByLabelText('Pro info')).not.toBeInTheDocument()
	})

	it('emits step.viewed on mount and step.completed + step.viewed on advance', async () => {
		const emit = vi.fn()
		const events: FormEventSink = { emit }
		render(<Form form={doc(linearFields, linearFlow, 7)} onSubmit={vi.fn()} events={events} />)
		await waitFor(() => {
			expect(emit).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'step.viewed', stepId: 's1', formId: '7' })
			)
		})
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		await waitFor(() => {
			expect(emit).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'step.completed', stepId: 's1' })
			)
			expect(emit).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'step.viewed', stepId: 's2' })
			)
		})
	})

	it('a form with no flow renders all fields with a single submit button', () => {
		render(<Form form={doc(linearFields)} onSubmit={vi.fn()} />)
		expect(screen.getByLabelText('First')).toBeInTheDocument()
		expect(screen.getByLabelText('Last')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
	})
})
