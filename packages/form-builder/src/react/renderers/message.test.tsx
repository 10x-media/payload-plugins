import { cleanup, render } from '@testing-library/react'
import { createElement, useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fieldKey } from '../../fields/fieldKey'
import type { FormFieldInstance } from '../../submissions/types'
import type { FieldRendererProps } from '../contract'
import { FormContext, type FormStepInfo } from '../FormContext'
import type { RendererRegistry } from '../registry'
import { formReducer, initialFormState } from '../state'
import { messageRenderer } from './message'

afterEach(() => {
	cleanup()
})

const lexical = (text: string, format = 0) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text, format }] }],
	},
})

const step: FormStepInfo = {
	stepIndex: 0,
	stepCount: 1,
	isFirst: true,
	isTerminal: true,
	goNext: () => {},
	goBack: () => {},
}

const emptyRegistry: RendererRegistry = new Map()

const rendererProps = (field: FormFieldInstance): FieldRendererProps => ({
	field,
	id: 'msg',
	name: fieldKey(field),
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
})

const Harness = ({
	field,
	values,
	effectiveValues,
}: {
	field: FormFieldInstance
	values: Record<string, unknown>
	effectiveValues?: Record<string, unknown>
}) => {
	const [state, dispatch] = useReducer(formReducer, initialFormState(values))
	return (
		<FormContext.Provider
			value={{
				state,
				dispatch,
				validateField: vi.fn(),
				locale: 'en',
				step,
				rendererRegistry: emptyRegistry,
				labels: { back: 'Back', next: 'Next', submit: 'Submit' },
				t: (key) => key,
				effectiveValues,
			}}
		>
			{createElement(messageRenderer, rendererProps(field))}
		</FormContext.Provider>
	)
}

describe('messageRenderer', () => {
	it('renders the serialized rich text as inline HTML', () => {
		const field: FormFieldInstance = {
			blockType: 'message',
			id: 'row-1',
			content: lexical('Read this first', 1),
		}
		const { container } = render(<Harness field={field} values={{}} />)
		const node = container.querySelector('.fb-field__message')
		expect(node?.innerHTML).toBe('<p><strong>Read this first</strong></p>')
	})

	it('interpolates recall tokens from the current answers, HTML-escaped', () => {
		const field: FormFieldInstance = {
			blockType: 'message',
			id: 'row-1',
			content: lexical('Hello {{first}}'),
		}
		const { container } = render(<Harness field={field} values={{ first: '<b>Ada</b>' }} />)
		expect(container.querySelector('.fb-field__message')?.innerHTML).toBe(
			'<p>Hello &lt;b&gt;Ada&lt;/b&gt;</p>'
		)
	})

	it('prefers calc-authoritative effectiveValues over raw state values', () => {
		const field: FormFieldInstance = {
			blockType: 'message',
			id: 'row-1',
			content: lexical('Total: {{total}}'),
		}
		const { container } = render(
			<Harness field={field} values={{}} effectiveValues={{ total: 42 }} />
		)
		expect(container.querySelector('.fb-field__message')?.innerHTML).toBe('<p>Total: 42</p>')
	})

	it('renders nothing when content is empty', () => {
		const field: FormFieldInstance = { blockType: 'message', id: 'row-1' }
		const { container } = render(<Harness field={field} values={{}} />)
		expect(container.querySelector('.fb-field__message')).toBeNull()
	})

	it('renders without a form context (empty answers)', () => {
		const field: FormFieldInstance = {
			blockType: 'message',
			id: 'row-1',
			content: lexical('Standalone'),
		}
		const { container } = render(createElement(messageRenderer, rendererProps(field)))
		expect(container.querySelector('.fb-field__message')?.innerHTML).toBe('<p>Standalone</p>')
	})
})
