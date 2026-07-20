import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldCountCell } from './FieldCountCell'

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
				'formBuilder:cell.fieldCount.one': '{{count}} Field',
				'formBuilder:cell.fieldCount.other': '{{count}} Fields',
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

describe('FieldCountCell', () => {
	it('renders the zero-plural form when cellData is empty', () => {
		const { container } = render(<FieldCountCell cellData={[]} />)
		expect(container.textContent).toBe('0 Fields')
	})

	it('renders the zero-plural form when cellData is absent', () => {
		const { container } = render(<FieldCountCell cellData={undefined} />)
		expect(container.textContent).toBe('0 Fields')
	})

	it('renders the singular form for exactly one field', () => {
		const { container } = render(<FieldCountCell cellData={[{ blockType: 'text' }]} />)
		expect(container.textContent).toBe('1 Field')
	})

	it('renders the plural form for more than one field', () => {
		const { container } = render(
			<FieldCountCell cellData={[{ blockType: 'text' }, { blockType: 'email' }]} />
		)
		expect(container.textContent).toBe('2 Fields')
	})
})
