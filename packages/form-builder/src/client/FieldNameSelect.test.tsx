import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldNameSelect } from './FieldNameSelect'

vi.mock('@payloadcms/ui', () => ({
	useField: () => ({ path: 'toField', value: '', setValue: vi.fn() }),
	useFormFields: (sel: (arg: [unknown]) => unknown) => sel([{}]),
	FieldLabel: () => null,
	FieldDescription: () => null,
	ReactSelect: () => null,
}))
vi.mock('payload/shared', () => ({ reduceFieldsToValues: () => ({ fields: [] }) }))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (k: string) => k }),
}))

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('FieldNameSelect width', () => {
	it('applies --field-width from admin.width so it can pair in a 50/50 row', () => {
		const { container } = render(
			<FieldNameSelect path="toField" field={{ admin: { width: '50%' } }} />
		)
		const root = container.querySelector('.field-type') as HTMLElement
		expect(root.style.getPropertyValue('--field-width')).toBe('50%')
	})

	it('sets no width style when admin.width is unset', () => {
		const { container } = render(<FieldNameSelect path="toField" field={{}} />)
		const root = container.querySelector('.field-type') as HTMLElement
		expect(root.style.getPropertyValue('--field-width')).toBe('')
	})
})
