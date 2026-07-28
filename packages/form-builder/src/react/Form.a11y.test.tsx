import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { FormFlow } from '../flow/types'
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

const doc = (fields: FormFieldInstance[]): FormDocument => ({
	id: 1,
	fields,
	multistep: false,
	pollEnabled: false,
})

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

	it('the select field radio and buttons displays have no structural violations', async () => {
		const fields: FormFieldInstance[] = [
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				display: 'radio',
				options: [
					{ label: 'Free', value: 'free' },
					{ label: 'Pro', value: 'pro' },
				],
			} as FormFieldInstance,
			{
				blockType: 'select',
				name: 'billing',
				label: 'Billing cycle',
				display: 'buttons',
				options: [
					{ label: 'Monthly', value: 'monthly' },
					{ label: 'Yearly', value: 'yearly' },
				],
			} as FormFieldInstance,
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
						source: 'terms-of-service',
						statement: 'I agree to the terms',
						link: { label: 'Terms of Service', url: 'https://example.com/terms' },
					} as FormFieldInstance,
				])}
			/>
		)
		expect(await axeViolations(container)).toEqual([])
		expect(screen.getByRole('checkbox')).toHaveAccessibleName('I agree to the terms')
	})

	// A form rendered without resolveConsentStatements has no statement to show. The field is
	// misconfigured either way, but it must not degrade into an unlabelled control.
	it('a consent field with no resolved statement is still a labelled control', async () => {
		const { container } = render(
			<Form
				form={doc([
					{ blockType: 'consent', name: 'terms', source: 'terms-of-service' } as FormFieldInstance,
				])}
			/>
		)
		expect(await axeViolations(container)).toEqual([])
		expect(screen.getByRole('checkbox')).toHaveAccessibleName('terms')
	})

	it('a consent field with a rich text statement containing an inline link has no structural violations', async () => {
		const statement = {
			root: {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [
							{ type: 'text', text: 'I agree to the ' },
							{
								type: 'link',
								fields: { url: 'https://example.com/privacy', newTab: true },
								children: [{ type: 'text', text: 'Privacy Policy' }],
							},
							{ type: 'text', text: '.' },
						],
					},
				],
			},
		}
		const { container } = render(
			<Form
				form={doc([
					{
						blockType: 'consent',
						name: 'terms',
						source: 'privacy',
						statement,
					} as FormFieldInstance,
				])}
			/>
		)
		expect(await axeViolations(container)).toEqual([])
		const checkbox = screen.getByRole('checkbox')
		expect(checkbox).toHaveAccessibleName('I agree to the Privacy Policy.')
		expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
			'href',
			'https://example.com/privacy'
		)
	})

	it('a multi-step form in its blocked-advance state has no structural violations', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First', required: true },
			{ blockType: 'text', name: 'last', label: 'Last' },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'], next: 's2' },
				{ id: 's2', fields: ['last'] },
			],
		}
		const { container } = render(
			<Form
				form={{ id: 1, fields, flow, multistep: true, pollEnabled: false }}
				onSubmit={async () => ({ ok: true })}
			/>
		)
		// A blocked advance renders the new markup: the step live region, the focusable step group, the
		// step-level alert, and the per-field alert. All of it must stay structurally accessible.
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		await screen.findByText('This field is required')
		expect(await axeViolations(container)).toEqual([])
	})
})
