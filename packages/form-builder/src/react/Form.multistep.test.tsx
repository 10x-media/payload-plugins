import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalcExpression } from '../calc/types'
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
	multistep: flow !== undefined,
	pollEnabled: false,
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
		{ id: 'basic', fields: ['basicInfo'], next: null },
		{ id: 'pro', fields: ['proInfo'] },
	],
}

describe('Form multi-step flow', () => {
	it('renders a fieldless step as a navigable page rather than a dead end', async () => {
		// A step keeps its place when every field it named is deleted from the form; the visitor gets
		// navigation only, and must still be able to pass through it in both directions.
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const emptyMiddleFlow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'] },
				{ id: 's2', fields: [] },
				{ id: 's3', fields: ['last'] },
			],
		}
		render(<Form form={doc(linearFields, emptyMiddleFlow)} onSubmit={onSubmit} />)

		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
		expect(screen.queryByLabelText('First')).not.toBeInTheDocument()
		expect(screen.queryByLabelText('Last')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Back' }))
		expect(await screen.findByLabelText('First')).toHaveValue('Ada')

		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('Last')).toBeInTheDocument()
	})

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
		expect(await screen.findByRole('alert')).toHaveTextContent('This field is required')
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

	it('advances sequentially through steps without next values and submits from the last', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'text', name: 'middle', label: 'Middle' },
			{ blockType: 'text', name: 'last', label: 'Last' },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'] },
				{ id: 's2', fields: ['middle'] },
				{ id: 's3', fields: ['last'] },
			],
		}
		render(<Form form={doc(fields, flow)} onSubmit={onSubmit} />)

		expect(screen.getByLabelText('First')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByLabelText('Middle')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByLabelText('Last')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 1,
				values: [{ field: 'first', value: 'Ada' }],
			})
		})
	})

	it('ends the form on a mid-array step with an explicit next: null', async () => {
		render(<Form form={doc(branchingFields, branchingFlow)} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'free' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('Basic info')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
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

	const doubled: CalcExpression = {
		type: 'op',
		op: '*',
		left: { type: 'ref', field: 'score' },
		right: { type: 'lit', value: 2 },
	}
	const calcRoutedFields: FormFieldInstance[] = [
		{ blockType: 'number', name: 'score', label: 'Score' },
		{ blockType: 'calculation', name: 'doubled', expression: doubled },
		{ blockType: 'text', name: 'highInfo', label: 'High info' },
		{ blockType: 'text', name: 'lowInfo', label: 'Low info' },
	]
	const calcRoutedFlow: FormFlow = {
		steps: [
			{
				id: 'entry',
				fields: ['score', 'doubled'],
				transitions: [{ when: { doubled: { equals: 20 } }, to: 'high' }],
				next: 'low',
			},
			{ id: 'high', fields: ['highInfo'], next: null },
			{ id: 'low', fields: ['lowInfo'] },
		],
	}

	it('routes a transition on a calculation field against the computed value, not the raw input', async () => {
		render(<Form form={doc(calcRoutedFields, calcRoutedFlow)} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Score'), { target: { value: '10' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('High info')).toBeInTheDocument()
		expect(screen.queryByLabelText('Low info')).not.toBeInTheDocument()
	})

	it('a form with no flow renders all fields with a single submit button', () => {
		render(<Form form={doc(linearFields)} onSubmit={vi.fn()} />)
		expect(screen.getByLabelText('First')).toBeInTheDocument()
		expect(screen.getByLabelText('Last')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
	})

	it('renders a single page when multistep is false even though flow data exists', () => {
		// The flag, not flow presence, drives multi-step. With it off, the stored flow is ignored and
		// every field renders on one page; the flow data itself is never cleared or destroyed.
		render(
			<Form form={{ ...doc(linearFields, linearFlow), multistep: false }} onSubmit={vi.fn()} />
		)
		expect(screen.getByLabelText('First')).toBeInTheDocument()
		expect(screen.getByLabelText('Last')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
	})

	it('renders a nameless message assigned to step 2 by row id only on step 2 of a 3-step flow', async () => {
		const lexical = (text: string) => ({
			root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
		})
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'message', id: 'row-note', content: lexical('Step-two note') },
			{ blockType: 'text', name: 'middle', label: 'Middle' },
			{ blockType: 'text', name: 'last', label: 'Last' },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'], next: 's2' },
				{ id: 's2', fields: ['row-note', 'middle'], next: 's3' },
				{ id: 's3', fields: ['last'] },
			],
		}
		render(<Form form={doc(fields, flow)} onSubmit={vi.fn()} />)

		expect(screen.queryByText('Step-two note')).not.toBeInTheDocument()

		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'a' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByText('Step-two note')).toBeInTheDocument()
		expect(screen.getByLabelText('Middle')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('Last')).toBeInTheDocument()
		expect(screen.queryByText('Step-two note')).not.toBeInTheDocument()
	})
})
