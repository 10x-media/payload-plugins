import { describe, expect, it } from 'vitest'
import type { SubmissionDescriptor, SubmissionValue } from '../../submissions/types'
import { renderAllValues, renderAllValuesTable } from './wildcards'

const values: SubmissionValue[] = [
	{ field: 'name', value: 'Ada' },
	{ field: 'topic', value: 'sales' },
]

const descriptors: SubmissionDescriptor[] = [
	{ field: 'name', label: 'Full name', fieldType: 'text' },
	{ field: 'topic', label: 'Topic', fieldType: 'select', optionLabels: { sales: 'Sales team' } },
]

describe('renderAllValues', () => {
	it('renders labelled lines joined with <br />', () => {
		expect(renderAllValues(values, descriptors)).toBe('Full name: Ada<br />Topic: Sales team')
	})

	it('skips values without a descriptor when descriptors exist', () => {
		const withInternal = [...values, { field: 'fb_hp', value: 'bot' }]
		expect(renderAllValues(withInternal, descriptors)).not.toContain('fb_hp')
	})

	it('includes all values and falls back to field names when there are no descriptors', () => {
		expect(renderAllValues(values, [])).toBe('name: Ada<br />topic: sales')
	})

	it('escapes labels and values', () => {
		const out = renderAllValues(
			[{ field: 'msg', value: '<script>alert(1)</script>' }],
			[{ field: 'msg', label: 'A & B', fieldType: 'text' }]
		)
		expect(out).toBe('A &amp; B: &lt;script&gt;alert(1)&lt;/script&gt;')
	})

	it('joins array values with a comma and maps option labels per entry', () => {
		const out = renderAllValues([{ field: 'topic', value: ['sales', 'other'] }], descriptors)
		expect(out).toBe('Topic: Sales team, other')
	})

	it('renders null and undefined values as empty', () => {
		expect(renderAllValues([{ field: 'name', value: null }], descriptors)).toBe('Full name: ')
	})
})

describe('renderAllValuesTable', () => {
	it('renders a two-column table', () => {
		expect(renderAllValuesTable(values, descriptors)).toBe(
			'<table><tbody><tr><td>Full name</td><td>Ada</td></tr><tr><td>Topic</td><td>Sales team</td></tr></tbody></table>'
		)
	})

	it('escapes cell content', () => {
		const out = renderAllValuesTable(
			[{ field: 'msg', value: '<img>' }],
			[{ field: 'msg', label: 'Message', fieldType: 'text' }]
		)
		expect(out).toContain('<td>&lt;img&gt;</td>')
	})
})
