import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(cleanup)

/**
 * jsdom has no layout engine, so rules needing rendered geometry are disabled here (color-contrast is
 * covered by the real-browser axe sweep in the e2e tier). Structural rules -- label association, accessible
 * names, roles, aria state -- run fully and are where real renderer a11y bugs surface. `region` is disabled
 * because the test mounts a bare `<form>` fragment, not a full landmarked page.
 */
const axeViolations = async (node: Element) => {
	const results = await axe.run(node as HTMLElement, {
		rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
	})
	return results.violations.map((violation) => violation.id)
}

const doc = (fields: FormFieldInstance[]): FormDocument => ({ id: 1, fields })

describe('Form accessibility (axe)', () => {
	it('a representative single-step form has no structural violations', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'name', label: 'Name', required: true },
			{ blockType: 'email', name: 'email', label: 'Email', required: true },
			{ blockType: 'number', name: 'age', label: 'Age' },
			{ blockType: 'textarea', name: 'bio', label: 'Bio' },
			{
				blockType: 'select',
				name: 'role',
				label: 'Role',
				options: [
					{ label: 'Developer', value: 'dev' },
					{ label: 'Other', value: 'other' },
				],
			},
			{ blockType: 'checkbox', name: 'subscribe', label: 'Subscribe to updates' },
		]
		const { container } = render(<Form form={doc(fields)} />)
		expect(await axeViolations(container)).toEqual([])
	})

	it('the post-submit error state has no structural violations', async () => {
		const { container } = render(
			<Form
				form={doc([{ blockType: 'text', name: 'name', label: 'Name', required: true }])}
				onSubmit={async () => ({ ok: false, message: 'x' })}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await screen.findByRole('alert')
		expect(await axeViolations(container)).toEqual([])
	})

	it('the consent field renders an accessible labelled control', async () => {
		const { container } = render(
			<Form
				form={doc([
					{
						blockType: 'consent',
						name: 'terms',
						label: 'I agree to the terms',
						source: 'static',
						sourceConfig: { label: 'Terms of Service', url: 'https://example.com/terms' },
					} as FormFieldInstance,
				])}
			/>
		)
		expect(await axeViolations(container)).toEqual([])
	})

	it('a consent field with a blank statement falls back to the field label (still labelled)', async () => {
		const { container } = render(
			<Form
				form={doc([
					{
						blockType: 'consent',
						name: 'terms',
						label: 'I agree to the terms',
						statement: '',
						source: 'static',
						sourceConfig: { label: 'Terms of Service', url: 'https://example.com/terms' },
					} as FormFieldInstance,
				])}
			/>
		)
		expect(await axeViolations(container)).toEqual([])
		expect(screen.getByText('I agree to the terms')).toBeTruthy()
	})
})
