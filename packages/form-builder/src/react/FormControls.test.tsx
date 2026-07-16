import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'
import { useFormContext } from './FormContext'
import { FormControls } from './FormControls'
import { FormSteps } from './FormSteps'
import { useField } from './useField'

afterEach(() => {
	cleanup()
})

const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{ blockType: 'text', name: 'last', label: 'Last' },
]
const flow: FormFlow = {
	steps: [
		{ id: 's1', title: 'Name', fields: ['first'], next: 's2' },
		{ id: 's2', fields: ['last'] },
	],
}

const doc = (overrides?: Partial<FormDocument>): FormDocument => ({
	id: 1,
	fields,
	...overrides,
})

describe('FormControls', () => {
	it('renders only a submit button for a single-step form, labeled from context', () => {
		render(
			<Form form={doc()} onSubmit={vi.fn()}>
				<FormControls />
			</Form>
		)
		const submit = screen.getByRole('button', { name: 'Submit' })
		expect(submit).toHaveAttribute('type', 'submit')
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
	})

	it("defaults the submit label to the form's response.submitLabel", () => {
		render(
			<Form
				form={doc({ response: { type: 'message', submitLabel: 'Send it' } })}
				onSubmit={vi.fn()}
			>
				<FormControls />
			</Form>
		)
		expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument()
	})

	it('prefers the Form submitLabel prop over the stored value', () => {
		render(
			<Form
				form={doc({ response: { type: 'message', submitLabel: 'Send it' } })}
				onSubmit={vi.fn()}
				submitLabel="Go"
			>
				<FormControls />
			</Form>
		)
		expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
	})

	it('per-button props override the context labels', async () => {
		render(
			<Form form={doc({ flow })} onSubmit={vi.fn()}>
				<FormControls backLabel="Previous" nextLabel="Continue" submitLabel="Finish" />
			</Form>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
		expect(await screen.findByRole('button', { name: 'Previous' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
	})

	it('hides back on the first step and shows next until the terminal step', async () => {
		render(
			<Form form={doc({ flow })} onSubmit={vi.fn()}>
				<FormControls />
			</Form>
		)
		expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
		const next = screen.getByRole('button', { name: 'Next' })
		expect(next).toHaveAttribute('type', 'button')

		fireEvent.click(next)
		const back = await screen.findByRole('button', { name: 'Back' })
		expect(back).toHaveAttribute('type', 'button')
		expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit')
		expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()

		fireEvent.click(back)
		expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument()
	})

	it('disables the buttons while submitting', async () => {
		let release: (value: { ok: true }) => void = () => {}
		const onSubmit = vi.fn().mockReturnValue(
			new Promise((resolve) => {
				release = resolve
			})
		)
		render(
			<Form form={doc()} onSubmit={onSubmit}>
				<FormControls />
			</Form>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
		})
		release({ ok: true })
	})

	it('forwards button class names and merges the fb- defaults', () => {
		render(
			<Form form={doc()} onSubmit={vi.fn()}>
				<FormControls className="my-controls" submitButtonClassName="my-submit" />
			</Form>
		)
		const submit = screen.getByRole('button', { name: 'Submit' })
		expect(submit).toHaveClass('fb-form__submit', 'my-submit')
		expect(submit.parentElement).toHaveClass('fb-form__controls', 'my-controls')
	})

	it('honors render overrides with the resolved label and handlers', async () => {
		const renderNext = vi.fn(({ label, onClick }) => (
			<button type="button" data-testid="custom-next" onClick={onClick}>
				{label}
			</button>
		))
		render(
			<Form form={doc({ flow })} onSubmit={vi.fn()}>
				<FormControls renderNext={renderNext} />
			</Form>
		)
		fireEvent.click(screen.getByTestId('custom-next'))
		expect(renderNext).toHaveBeenCalledWith(
			expect.objectContaining({ label: 'Next', submitting: false })
		)
		expect(await screen.findByRole('button', { name: 'Submit' })).toBeInTheDocument()
	})
})

describe('FormControls composed inside a custom children layout', () => {
	const StepFields = () => {
		const { step } = useFormContext()
		const names = step.flow?.steps[step.stepIndex]?.fields ?? []
		return (
			<>
				{names.map((name) => (
					<CustomInput key={name} name={name} />
				))}
			</>
		)
	}

	const CustomInput = ({ name }: { name: string }) => {
		const { value, setValue } = useField<string>(name)
		return (
			<input aria-label={name} value={value ?? ''} onChange={(e) => setValue(e.target.value)} />
		)
	}

	it('navigates steps, tracks progress, and submits through the shared chrome', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		render(
			<Form form={doc({ flow })} onSubmit={onSubmit}>
				<FormSteps />
				<StepFields />
				<FormControls />
			</Form>
		)
		expect(screen.getByText('Name')).toHaveAttribute('aria-current', 'step')

		fireEvent.change(screen.getByLabelText('first'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByLabelText('last')).toBeInTheDocument()
		expect(screen.getByText('Step 2')).toHaveAttribute('aria-current', 'step')
		expect(screen.getByText('Name')).not.toHaveAttribute('aria-current')

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 1,
				values: [{ field: 'first', value: 'Ada' }],
			})
		})
	})
})
