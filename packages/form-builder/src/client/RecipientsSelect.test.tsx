import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecipientsSelect } from './RecipientsSelect'

// biome-ignore lint/suspicious/noExplicitAny: the mock captures whatever props ReactSelect is handed
const captured = vi.hoisted(() => ({ props: null as any }))
const fieldState = vi.hoisted(() => ({
	current: {
		path: 'to',
		value: [] as unknown,
		setValue: vi.fn(),
		disabled: false,
		showError: false,
		customComponents: {},
	},
}))
vi.mock('@payloadcms/ui', () => ({
	useField: () => fieldState.current,
	useFormFields: (sel: (arg: [unknown]) => unknown) => sel([{}]),
	useDocumentInfo: () => ({ id: undefined, collectionSlug: 'forms' }),
	useConfig: () => ({ config: { routes: { api: '/api' } } }),
	FieldLabel: () => null,
	FieldError: () => null,
	FieldDescription: () => null,
	RenderCustomComponent: ({ Fallback }: { Fallback: ReactNode }) => Fallback,
	// biome-ignore lint/suspicious/noExplicitAny: capture props for assertions
	ReactSelect: (p: any) => {
		captured.props = p
		return null
	},
}))
vi.mock('payload/shared', () => ({ reduceFieldsToValues: () => ({ fields: [] }) }))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	captured.props = null
})

describe('RecipientsSelect', () => {
	it('is a creatable, sortable multi-select that gates creation on a valid email', () => {
		fieldState.current = { ...fieldState.current, value: [] }
		render(<RecipientsSelect path="to" field={{ label: 'To' }} />)
		expect(captured.props.isCreatable).toBe(true)
		expect(captured.props.isMulti).toBe(true)
		expect(captured.props.isSortable).toBe(true)
		expect(captured.props.filterOption(null, 'a@b.com')).toBe(true)
		expect(captured.props.filterOption(null, 'nope')).toBe(false)
	})

	it('renders stored values as badges, keeping unknown values selectable', () => {
		fieldState.current = { ...fieldState.current, value: ['x@y.com'] }
		render(<RecipientsSelect path="to" field={{ label: 'To' }} />)
		expect(captured.props.value).toEqual([{ label: 'x@y.com', value: 'x@y.com' }])
	})

	it('dedupes case-insensitively and drops junk on change', () => {
		const setValue = vi.fn()
		fieldState.current = { ...fieldState.current, value: [], setValue }
		render(<RecipientsSelect path="to" field={{ label: 'To' }} />)
		captured.props.onChange([{ value: 'A@B.com' }, { value: 'a@b.com' }, { value: 'junk' }])
		expect(setValue).toHaveBeenCalledWith(['A@B.com'])
	})

	it('drops isCreatable when allowCustom is false', () => {
		fieldState.current = { ...fieldState.current, value: [] }
		render(<RecipientsSelect path="to" field={{ label: 'To' }} allowCustom={false} />)
		expect(captured.props.isCreatable).toBe(false)
		expect(captured.props.filterOption(null, 'a@b.com')).toBe(false)
	})

	it('offers registered sources as their own group and resolves a stored source label', () => {
		fieldState.current = { ...fieldState.current, value: ['context:pageContact'] }
		render(
			<RecipientsSelect
				path="to"
				field={{ label: 'To' }}
				sources={[{ value: 'context:pageContact', label: { en: 'The person', de: 'Die Person' } }]}
			/>
		)
		const groups = captured.props.options as { label: string; options: { value: string }[] }[]
		const sourceGroup = groups.find((g) => g.options.some((o) => o.value === 'context:pageContact'))
		expect(sourceGroup?.options[0]).toEqual({ value: 'context:pageContact', label: 'The person' })
		expect(captured.props.value).toEqual([{ value: 'context:pageContact', label: 'The person' }])
	})

	it('accepts a source value on change even when allowCustom is false', () => {
		const setValue = vi.fn()
		fieldState.current = { ...fieldState.current, value: [], setValue }
		render(
			<RecipientsSelect
				path="to"
				field={{ label: 'To' }}
				allowCustom={false}
				sources={[{ value: 'context:pageContact', label: 'The person' }]}
			/>
		)
		captured.props.onChange([{ value: 'context:pageContact' }])
		expect(setValue).toHaveBeenCalledWith(['context:pageContact'])
	})

	it('applies --field-width from admin.width', () => {
		fieldState.current = { ...fieldState.current, value: [] }
		const { container } = render(
			<RecipientsSelect path="to" field={{ label: 'To', admin: { width: '50%' } }} />
		)
		const root = container.querySelector('.field-type') as HTMLElement
		expect(root.style.getPropertyValue('--field-width')).toBe('50%')
	})
})
