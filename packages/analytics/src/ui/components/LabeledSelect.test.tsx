import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { a11yViolations } from '../../testing/a11y'
import { LabeledSelect } from './LabeledSelect'

vi.mock('@payloadcms/ui', async () => ({
	...(await import('../../testing/selectMocks')).selectMocks,
}))

afterEach(() => {
	cleanup()
})

const options = [
	{ value: 'native', label: 'Native' },
	{ value: 'memory', label: 'In-memory (testing)' },
] as const

describe('LabeledSelect', () => {
	// Payload's SelectInput points its label at the wrapper, which leaves the combobox unnamed.
	it('names its input through a label pointing at it', () => {
		const { container } = render(
			<LabeledSelect label="Data source" onChange={() => {}} options={options} value="native" />
		)
		const input = screen.getByRole('combobox', { name: 'Data source' })
		expect(container.querySelector('label')?.getAttribute('for')).toBe(input.id)
		expect(input.id).not.toBe('')
		expect(a11yViolations(container)).toEqual([])
	})

	it('answers the value of the option picked', () => {
		const onChange = vi.fn()
		render(
			<LabeledSelect label="Data source" onChange={onChange} options={options} value="native" />
		)
		fireEvent.change(screen.getByRole('combobox', { name: 'Data source' }), {
			target: { value: 'memory' },
		})
		expect(onChange).toHaveBeenCalledWith('memory')
	})

	it("draws in the wrapper of Payload's own select field, a field style on it", () => {
		const { container } = render(
			<LabeledSelect
				className="custom"
				label="Rows"
				onChange={() => {}}
				options={options}
				style={{ width: '50%' }}
				value="native"
			/>
		)
		const wrapper = container.firstElementChild
		expect(wrapper?.className).toBe('field-type select analytics-select custom')
		expect(wrapper instanceof HTMLElement ? wrapper.style.width : '').toBe('50%')
	})

	it('shows no choice for a value among none of its options', () => {
		render(
			<LabeledSelect label="Data source" onChange={() => {}} options={options} value={undefined} />
		)
		const input = screen.getByRole('combobox', { name: 'Data source' })
		expect(input instanceof HTMLSelectElement ? input.value : 'x').toBe('')
	})
})
