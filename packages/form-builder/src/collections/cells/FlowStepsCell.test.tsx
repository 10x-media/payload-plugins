import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlowStepsCell } from './FlowStepsCell'

afterEach(() => {
	cleanup()
})

/**
 * Mirrors Payload's real `t(key, vars)`: looks up the template by key, then
 * replaces `{{var}}` tokens from `vars`. Verifies the component's own contract
 * with `useTranslation` (which key it asks for, which vars it passes) against
 * the same interpolation shape Payload actually runs in the admin panel.
 */
vi.mock('../../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string, vars?: Record<string, unknown>) => {
			const templates: Record<string, string> = {
				'formBuilder:cell.stepCount.one': '{{count}} step',
				'formBuilder:cell.stepCount.other': '{{count}} steps',
			}
			const template = templates[key] ?? key
			if (!vars) {
				return template
			}
			return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
				Object.hasOwn(vars, name) ? String(vars[name]) : match
			)
		},
	}),
}))

describe('FlowStepsCell', () => {
	it('renders the empty placeholder when cellData has no steps', () => {
		const { container } = render(<FlowStepsCell cellData={{ steps: [] }} />)
		expect(container.textContent).toBe('—')
	})

	it('renders the empty placeholder when cellData is absent', () => {
		const { container } = render(<FlowStepsCell cellData={undefined} />)
		expect(container.textContent).toBe('—')
	})

	it('renders the empty placeholder when steps is not an array', () => {
		const { container } = render(
			<FlowStepsCell cellData={{ steps: 'not-an-array' } as unknown as { steps?: unknown[] }} />
		)
		expect(container.textContent).toBe('—')
	})

	it('renders the singular form for exactly one step', () => {
		const { container } = render(<FlowStepsCell cellData={{ steps: [{ id: 'a' }] }} />)
		expect(container.textContent).toBe('1 step')
	})

	it('renders the plural form for more than one step', () => {
		const { container } = render(<FlowStepsCell cellData={{ steps: [{ id: 'a' }, { id: 'b' }] }} />)
		expect(container.textContent).toBe('2 steps')
	})
})
