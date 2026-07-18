import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ArrayFieldClientProps } from 'payload'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CondensedArray } from './CondensedArray'

const { addFieldRow, removeFieldRow, fieldState } = vi.hoisted(() => ({
	addFieldRow: vi.fn(),
	removeFieldRow: vi.fn(),
	fieldState: {
		current: {
			path: 'departmentEmails',
			rows: [] as Array<{ id: string }>,
			customComponents: {} as Record<string, ReactNode>,
		},
	},
}))

type ButtonProps = { children?: ReactNode; onClick?: () => void; 'aria-label'?: string }

vi.mock('@payloadcms/ui', () => ({
	Button: ({ children, onClick, 'aria-label': ariaLabel }: ButtonProps) => (
		<button type="button" onClick={onClick} aria-label={ariaLabel}>
			{children}
		</button>
	),
	FieldLabel: ({ label }: { label?: ReactNode }) => <span className="field-label">{label}</span>,
	FieldDescription: ({ description }: { description?: ReactNode }) => (
		<span className="field-description">{description}</span>
	),
	RenderCustomComponent: ({
		CustomComponent,
		Fallback,
	}: {
		CustomComponent?: ReactNode
		Fallback?: ReactNode
	}) => <>{CustomComponent ?? Fallback}</>,
	RenderFields: ({ parentPath }: { parentPath: string }) => (
		<div className="render-fields" data-parent-path={parentPath} />
	),
	useField: () => fieldState.current,
	useForm: () => ({ addFieldRow, removeFieldRow }),
}))

vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string) =>
			({
				'formBuilder:departments.addRow': 'Add email',
				'formBuilder:departments.removeRow': 'Remove email',
			})[key] ?? key,
	}),
}))

const makeProps = (rows: Array<{ id: string }>) => {
	fieldState.current = { path: 'departmentEmails', rows, customComponents: {} }
	return {
		field: {
			name: 'departmentEmails',
			type: 'array',
			label: 'Department emails',
			fields: [
				{ name: 'label', type: 'text', label: 'Label' },
				{ name: 'email', type: 'text', label: 'Email' },
			],
		},
		path: 'departmentEmails',
		schemaPath: 'departmentEmails',
		permissions: true,
		readOnly: false,
	} as unknown as ArrayFieldClientProps
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('CondensedArray', () => {
	it('renders every row flat, with no collapsible chrome', () => {
		const { container } = render(<CondensedArray {...makeProps([{ id: 'a' }, { id: 'b' }])} />)
		expect(container.querySelectorAll('.fb-condensed-array__row')).toHaveLength(2)
		expect(container.querySelector('.collapsible, [class*="collapsible"]')).toBeNull()
	})

	it('renders each row through RenderFields at its own {path}.{index}, so per-locale storage stays native', () => {
		const { container } = render(<CondensedArray {...makeProps([{ id: 'a' }, { id: 'b' }])} />)
		const paths = Array.from(container.querySelectorAll('.render-fields')).map((node) =>
			node.getAttribute('data-parent-path')
		)
		expect(paths).toEqual(['departmentEmails.0', 'departmentEmails.1'])
	})

	it('adds a row at the end via addFieldRow when the add button is clicked', () => {
		const { getByText } = render(<CondensedArray {...makeProps([{ id: 'a' }, { id: 'b' }])} />)
		fireEvent.click(getByText('Add email'))
		expect(addFieldRow).toHaveBeenCalledWith({
			path: 'departmentEmails',
			rowIndex: 2,
			schemaPath: 'departmentEmails',
		})
	})

	it('removes the clicked row via removeFieldRow', () => {
		const { getAllByLabelText } = render(
			<CondensedArray {...makeProps([{ id: 'a' }, { id: 'b' }])} />
		)
		const removeButtons = getAllByLabelText('Remove email')
		expect(removeButtons).toHaveLength(2)
		fireEvent.click(removeButtons[1] as HTMLElement)
		expect(removeFieldRow).toHaveBeenCalledWith({ path: 'departmentEmails', rowIndex: 1 })
	})

	it('renders only the add button when there are no rows', () => {
		const { container, getByText, queryByLabelText } = render(<CondensedArray {...makeProps([])} />)
		expect(container.querySelector('.fb-condensed-array__row')).toBeNull()
		expect(container.querySelector('.render-fields')).toBeNull()
		expect(getByText('Add email')).toBeInTheDocument()
		expect(queryByLabelText('Remove email')).toBeNull()
	})
})
