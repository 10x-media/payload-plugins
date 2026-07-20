import { cleanup, render } from '@testing-library/react'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnswerItem } from './SubmissionAnswersClient'
import {
	type ConsentItem,
	type MetaItem,
	type RepeaterItem,
	SubmissionAnswersClient,
	type SubmissionAnswersLabels,
} from './SubmissionAnswersClient'

vi.mock('@payloadcms/ui', () => ({
	FieldLabel: ({ label }: { label?: ReactNode }) => <span className="field-label">{label}</span>,
	TextInput: ({
		path,
		label,
		value,
		style,
	}: {
		path: string
		label?: ReactNode
		value?: string
		style?: CSSProperties
	}) => (
		<div className="field-type text" data-path={path} data-style={JSON.stringify(style ?? {})}>
			<span className="field-label">{label}</span>
			<input readOnly value={value} />
		</div>
	),
	Pill: ({
		children,
		pillStyle,
		size,
		rounded,
	}: {
		children?: ReactNode
		pillStyle?: string
		size?: string
		rounded?: boolean
	}) => (
		<span
			className="pill"
			data-pill-style={pillStyle}
			data-size={size}
			data-rounded={String(Boolean(rounded))}
		>
			{children}
		</span>
	),
}))

const labels: SubmissionAnswersLabels = {
	answers: 'Answers',
	consent: 'Consent',
	submissionDetails: 'Submission details',
	agreed: 'Agreed',
	declined: 'Declined',
	row: 'Row {n}',
	empty: 'No answers',
}

const render_ = (over: Partial<Parameters<typeof SubmissionAnswersClient>[0]> = {}) =>
	render(
		<SubmissionAnswersClient
			answers={over.answers ?? []}
			repeaters={over.repeaters ?? []}
			consent={over.consent ?? []}
			meta={over.meta ?? []}
			labels={labels}
		/>
	)

const styleOf = (el: Element | null): CSSProperties =>
	el ? (JSON.parse(el.getAttribute('data-style') ?? '{}') as CSSProperties) : {}

afterEach(() => cleanup())

describe('SubmissionAnswersClient', () => {
	it('renders a Payload success Pill for an agreed consent and an error Pill for a declined one', () => {
		const consent: ConsentItem[] = [
			{ field: 'terms', agreed: true, at: '1 Jan 2026' },
			{ field: 'news', agreed: false, at: '1 Jan 2026' },
		]
		const { container } = render_({ consent })
		const success = container.querySelector('.pill[data-pill-style="success"]')
		const error = container.querySelector('.pill[data-pill-style="error"]')
		expect(success?.textContent).toBe('Agreed')
		expect(error?.textContent).toBe('Declined')
		// Both consent Pills are small + rounded, matching the native pill treatment.
		expect(success?.getAttribute('data-size')).toBe('small')
		expect(success?.getAttribute('data-rounded')).toBe('true')
	})

	it('wraps each section in a native .render-fields container so field rows get native margins', () => {
		const answers: AnswerItem[] = [{ field: 'a', label: 'A', value: 'x' }]
		const consent: ConsentItem[] = [{ field: 'terms', agreed: true, at: 'now' }]
		const meta: MetaItem[] = [{ label: 'Locale', value: 'en' }]
		const { container } = render_({ answers, consent, meta })
		expect(container.querySelectorAll('.render-fields')).toHaveLength(3)
	})

	it('sizes each answer by its width, defaulting a width-less answer to full', () => {
		const answers: AnswerItem[] = [
			{ field: 'half', label: 'Half', value: 'h', width: 'half' },
			{ field: 'third', label: 'Third', value: 't', width: 'third' },
			{ field: 'plain', label: 'Plain', value: 'p' },
		]
		const { container } = render_({ answers })
		const half = styleOf(container.querySelector('[data-path="sa-half"]'))
		const third = styleOf(container.querySelector('[data-path="sa-third"]'))
		const plain = styleOf(container.querySelector('[data-path="sa-plain"]'))
		expect(half.flex).toContain('50%')
		expect(half.minWidth).toBeDefined()
		expect(third.flex).toContain('33.333%')
		expect(plain.flex).toBe('1 1 100%')
		expect(plain.minWidth).toBeUndefined()
	})

	it('keeps file links and repeaters full-width regardless of neighbouring fractional fields', () => {
		const answers: AnswerItem[] = [
			{ field: 'half', label: 'Half', value: 'h', width: 'half' },
			{ field: 'cv', label: 'CV', value: 'cv.pdf', href: 'https://x/cv.pdf' },
		]
		const repeaters: RepeaterItem[] = [
			{
				field: 'items',
				label: 'Items',
				rows: [{ id: '0', subFields: [{ label: 'Note', value: 'hi' }] }],
			},
		]
		const { container } = render_({ answers, repeaters })
		const link = container.querySelector('a[href="https://x/cv.pdf"]')
		const linkWrapper = link?.closest('.field-type') as HTMLElement | null
		expect(linkWrapper?.getAttribute('style')).toContain('100%')
		// The repeater row heading interpolates the 1-based row number from the label template.
		expect(container.textContent).toContain('Row 1')
	})

	it('renders the empty state when there is nothing to show', () => {
		const { getByText } = render_()
		expect(getByText('No answers')).toBeInTheDocument()
	})
})
