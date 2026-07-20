import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'
import { FormControls } from './FormControls'
import { FormSteps } from './FormSteps'

afterEach(() => {
	cleanup()
})

const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{ blockType: 'text', name: 'last', label: 'Last' },
]
const flow: FormFlow = {
	steps: [
		{ id: 's1', title: '  Contact  ', fields: ['first'], next: 's2' },
		{ id: 's2', fields: ['last'] },
	],
}

const doc = (withFlow?: FormFlow): FormDocument => ({
	id: 1,
	fields,
	flow: withFlow,
	multistep: Boolean(withFlow),
	pollEnabled: false,
})

describe('FormSteps', () => {
	it('renders nothing when the form has no flow', () => {
		const { container } = render(
			<Form form={doc()} onSubmit={vi.fn()}>
				<FormSteps />
			</Form>
		)
		expect(container.querySelector('.fb-form-steps')).toBeNull()
	})

	it('lists every step with trimmed titles and the translated "Step {n}" fallback', () => {
		render(
			<Form form={doc(flow)} onSubmit={vi.fn()}>
				<FormSteps />
			</Form>
		)
		const items = screen.getAllByRole('listitem')
		expect(items.map((item) => item.textContent)).toEqual(['Contact', 'Step 2'])
	})

	it('marks only the current step and moves the marker on navigation', async () => {
		render(
			<Form form={doc(flow)} onSubmit={vi.fn()}>
				<FormSteps />
				<FormControls />
			</Form>
		)
		expect(screen.getByText('Contact')).toHaveAttribute('aria-current', 'step')
		expect(screen.getByText('Contact')).toHaveClass('fb-form-steps__step--current')
		expect(screen.getByText('Step 2')).not.toHaveAttribute('aria-current')

		fireEvent.click(screen.getByRole('button', { name: 'Next' }))

		expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
		expect(screen.getByText('Step 2')).toHaveAttribute('aria-current', 'step')
		expect(screen.getByText('Contact')).not.toHaveAttribute('aria-current')
	})

	it('resolves the fallback through a custom translator', () => {
		render(
			<Form
				form={doc(flow)}
				onSubmit={vi.fn()}
				t={(key) => (key === 'formBuilder:flow.stepFallbackTitle' ? 'Schritt {n}' : key)}
			>
				<FormSteps />
			</Form>
		)
		expect(screen.getByText('Schritt 2')).toBeInTheDocument()
	})

	it('forwards className onto the list', () => {
		render(
			<Form form={doc(flow)} onSubmit={vi.fn()}>
				<FormSteps className="my-steps" />
			</Form>
		)
		expect(screen.getByRole('list')).toHaveClass('fb-form-steps', 'my-steps')
	})
})
