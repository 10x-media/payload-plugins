import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

// A required field's label carries an aria-hidden " *", so match labels by substring, not exact text.
const byLabel = (name: string) => screen.getByLabelText(name, { exact: false })
const findByLabel = (name: string) => screen.findByLabelText(name, { exact: false })
const queryByLabel = (name: string) => screen.queryByLabelText(name, { exact: false })

// Two steps: step 1 owns a required text field, step 2 (terminal) a plain one.
const twoStepFields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First', required: true },
	{ blockType: 'text', name: 'last', label: 'Last' },
]
const twoStepFlow: FormFlow = {
	steps: [
		{ id: 's1', fields: ['first'], next: 's2' },
		{ id: 's2', fields: ['last'] },
	],
}

// Three steps, nothing required: advances freely, for state-preservation and re-entrancy guards.
const threeFields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{ blockType: 'text', name: 'middle', label: 'Middle' },
	{ blockType: 'text', name: 'last', label: 'Last' },
]
const threeFlow: FormFlow = {
	steps: [
		{ id: 's1', fields: ['first'], next: 's2' },
		{ id: 's2', fields: ['middle'], next: 's3' },
		{ id: 's3', fields: ['last'] },
	],
}

const ok = () => vi.fn().mockResolvedValue({ ok: true })

describe('Defect A: Enter advances a multi-step form', () => {
	it('advances to the next step on Enter in a valid single-line field, without submitting', async () => {
		const onSubmit = ok()
		render(<Form form={doc(twoStepFields, twoStepFlow)} onSubmit={onSubmit} />)
		const first = byLabel('First')
		fireEvent.change(first, { target: { value: 'Ada' } })
		fireEvent.keyDown(first, { key: 'Enter' })
		expect(await findByLabel('Last')).toBeInTheDocument()
		expect(queryByLabel('First')).toBeNull()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it('stays on the step, reveals the error, and focuses the field on Enter with a required field empty', async () => {
		const onSubmit = ok()
		render(<Form form={doc(twoStepFields, twoStepFlow)} onSubmit={onSubmit} />)
		const first = byLabel('First')
		fireEvent.keyDown(first, { key: 'Enter' })
		expect(await screen.findByText('This field is required')).toBeInTheDocument()
		expect(queryByLabel('Last')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(byLabel('First')))
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it('leaves Enter uncancelled on the terminal step so the browser submits natively', async () => {
		render(<Form form={doc(twoStepFields, twoStepFlow)} onSubmit={ok()} />)
		fireEvent.change(byLabel('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		const last = await findByLabel('Last')
		// jsdom does not simulate implicit submission, so assert the guard steps aside on the terminal
		// step: fireEvent returns true when no handler called preventDefault, i.e. native submit proceeds.
		expect(fireEvent.keyDown(last, { key: 'Enter' })).toBe(true)
	})

	it('leaves Enter in a textarea alone and does not change step', () => {
		const withTextarea: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'textarea', name: 'note', label: 'Note' },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first', 'note'], next: 's2' },
				{ id: 's2', fields: [] },
			],
		}
		render(<Form form={doc(withTextarea, flow)} onSubmit={vi.fn()} />)
		expect(fireEvent.keyDown(byLabel('Note'), { key: 'Enter' })).toBe(true)
		expect(byLabel('Note')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
	})

	it('keeps native Enter-to-submit on a single-step form', () => {
		const single: FormFieldInstance[] = [{ blockType: 'text', name: 'only', label: 'Only' }]
		render(<Form form={doc(single)} onSubmit={vi.fn()} />)
		expect(fireEvent.keyDown(byLabel('Only'), { key: 'Enter' })).toBe(true)
	})
})

describe('Defect B: per-step error reveal', () => {
	it('does not carry an earlier step’s revealed errors onto a later step after correcting and advancing', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First', required: true },
			{ blockType: 'text', name: 'last', label: 'Last', required: true },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'], next: 's2' },
				{ id: 's2', fields: ['last'] },
			],
		}
		render(<Form form={doc(fields, flow)} onSubmit={ok()} />)
		// Blocked advance reveals step 1's error.
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByText('This field is required')).toBeInTheDocument()
		// Correct step 1 and advance.
		fireEvent.change(byLabel('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		// On step 2, the untouched required field shows no error on arrival.
		expect(await findByLabel('Last')).toBeInTheDocument()
		expect(screen.queryByText('This field is required')).toBeNull()
		expect(byLabel('Last')).not.toHaveAttribute('aria-invalid')
	})

	it('reveals an arrived-at step’s field error only after it is blurred, not on arrival', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First', required: true },
			{ blockType: 'email', name: 'contact', label: 'Contact', required: true },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'], next: 's2' },
				{ id: 's2', fields: ['contact'] },
			],
		}
		render(<Form form={doc(fields, flow)} onSubmit={ok()} />)
		fireEvent.change(byLabel('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		const contact = await findByLabel('Contact')
		// Typing an invalid value on a step arrived at without attempting reveals nothing yet.
		fireEvent.change(contact, { target: { value: 'nope' } })
		expect(byLabel('Contact')).not.toHaveAttribute('aria-invalid')
		// Blur reveals it.
		fireEvent.blur(contact)
		await waitFor(() => expect(byLabel('Contact')).toHaveAttribute('aria-invalid', 'true'))
	})
})

describe('Terminal Submit routes to the first invalid step', () => {
	it('returns to the earliest invalid step and focuses its field rather than failing in place', async () => {
		// `first` on step 1 is required only once `plan` (chosen on step 2) equals "pro", so step 1
		// advances while empty, then the terminal submit surfaces it and must route back to step 1.
		const fields: FormFieldInstance[] = [
			{
				blockType: 'text',
				name: 'first',
				label: 'First',
				required: true,
				validateWhen: { plan: { equals: 'pro' } },
			},
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				options: [
					{ label: 'Free', value: 'free' },
					{ label: 'Pro', value: 'pro' },
				],
			},
			{ blockType: 'text', name: 'notes', label: 'Notes' },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'], next: 's2' },
				{ id: 's2', fields: ['plan'], next: 's3' },
				{ id: 's3', fields: ['notes'] },
			],
		}
		const onSubmit = ok()
		render(<Form form={doc(fields, flow)} onSubmit={onSubmit} />)
		// Step 1: leave `first` empty; validateWhen is unmet (no plan yet), so it advances.
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		// Step 2: choose "pro", advance.
		fireEvent.change(await findByLabel('Plan'), { target: { value: 'pro' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		// Step 3 (terminal): submit routes back to step 1.
		fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
		expect(await findByLabel('First')).toBeInTheDocument()
		expect(queryByLabel('Notes')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(byLabel('First')))
		expect(onSubmit).not.toHaveBeenCalled()
	})
})

describe('Focus and accessibility on step transitions', () => {
	it('moves focus into the new step region on advance and on back', async () => {
		render(<Form form={doc(twoStepFields, twoStepFlow)} onSubmit={ok()} />)
		fireEvent.change(byLabel('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		await findByLabel('Last')
		await waitFor(() => expect(document.activeElement).toHaveAttribute('data-fb-step-region'))
		fireEvent.click(screen.getByRole('button', { name: 'Back' }))
		await findByLabel('First')
		await waitFor(() => expect(document.activeElement).toHaveAttribute('data-fb-step-region'))
	})

	it('announces the current step through an aria-live region', async () => {
		render(<Form form={doc(twoStepFields, twoStepFlow)} onSubmit={ok()} />)
		expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
		fireEvent.change(byLabel('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByText('Step 2 of 2')).toBeInTheDocument()
	})

	it('surfaces a role=alert step summary and focuses the first invalid field on a blocked advance', async () => {
		render(<Form form={doc(twoStepFields, twoStepFlow)} onSubmit={vi.fn()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		const summary = await screen.findByText('Please correct the highlighted fields to continue.')
		expect(summary).toHaveAttribute('role', 'alert')
		expect(screen.getByText('This field is required')).toBeInTheDocument()
		await waitFor(() => expect(document.activeElement).toBe(byLabel('First')))
	})
})

describe('Re-entrancy, idempotency, and state preservation', () => {
	it('advances exactly one step when Next is activated twice in rapid succession', async () => {
		render(<Form form={doc(threeFields, threeFlow)} onSubmit={ok()} />)
		const next = screen.getByRole('button', { name: 'Next' })
		fireEvent.click(next)
		fireEvent.click(next)
		// Landed on step 2, not step 3.
		expect(await findByLabel('Middle')).toBeInTheDocument()
		expect(queryByLabel('Last')).toBeNull()
		// A single Back returns to step 1 with no Back control left: exactly one history entry was pushed.
		fireEvent.click(screen.getByRole('button', { name: 'Back' }))
		expect(await findByLabel('First')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
	})

	it('fires onSubmit once when the form is submitted twice in rapid succession', async () => {
		const onSubmit = ok()
		const single: FormFieldInstance[] = [{ blockType: 'text', name: 'only', label: 'Only' }]
		render(<Form form={doc(single)} onSubmit={onSubmit} />)
		const submit = screen.getByRole('button', { name: 'Submit' })
		fireEvent.click(submit)
		fireEvent.click(submit)
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
	})

	it('cannot be resubmitted from the success screen', async () => {
		const onSubmit = ok()
		const single: FormFieldInstance[] = [{ blockType: 'text', name: 'only', label: 'Only' }]
		render(<Form form={doc(single)} onSubmit={onSubmit} />)
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await screen.findByRole('status')
		expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
		expect(onSubmit).toHaveBeenCalledTimes(1)
	})

	it('submits a value entered on step 1 after visiting the later steps', async () => {
		const onSubmit = ok()
		render(<Form form={doc(threeFields, threeFlow)} onSubmit={onSubmit} />)
		fireEvent.change(byLabel('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		fireEvent.change(await findByLabel('Middle'), { target: { value: 'M' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		fireEvent.change(await findByLabel('Last'), { target: { value: 'Lovelace' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
		const values = onSubmit.mock.calls[0]?.[0]?.values
		expect(values).toEqual(
			expect.arrayContaining([
				{ field: 'first', value: 'Ada' },
				{ field: 'middle', value: 'M' },
				{ field: 'last', value: 'Lovelace' },
			])
		)
	})

	it('does not let a conditionally hidden required field block advancing', async () => {
		// `secret` is required but only visible once `shown` equals "reveal"; while hidden it is neither
		// validated nor revealed, so an empty step advances.
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'shown', label: 'Shown' },
			{
				blockType: 'text',
				name: 'secret',
				label: 'Secret',
				required: true,
				visibleWhen: { shown: { equals: 'reveal' } },
			},
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['shown', 'secret'], next: 's2' },
				{ id: 's2', fields: [] },
			],
		}
		render(<Form form={doc(fields, flow)} onSubmit={ok()} />)
		expect(queryByLabel('Secret')).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		// The hidden required field is not validated, so the step advances (Back appears on step 2).
		expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
	})
})
