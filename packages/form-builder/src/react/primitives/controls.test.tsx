import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Checkbox } from './Checkbox'
import { Input } from './Input'
import { Select } from './Select'
import { Textarea } from './Textarea'

afterEach(() => {
	cleanup()
})

describe('Input', () => {
	it('renders with the given value', () => {
		const { container } = render(<Input id="i1" name="email" value="hello" onChange={vi.fn()} />)
		expect(within(container).getByRole('textbox')).toHaveValue('hello')
	})

	it('calls onChange with the new string value', () => {
		const onChange = vi.fn()
		const { container } = render(<Input id="i1" name="email" value="" onChange={onChange} />)
		fireEvent.change(within(container).getByRole('textbox'), { target: { value: 'hi' } })
		expect(onChange).toHaveBeenCalledWith('hi')
	})

	it('sets aria-invalid when invalid', () => {
		const { container } = render(<Input id="i1" name="email" value="" onChange={vi.fn()} invalid />)
		expect(within(container).getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
	})

	it('omits aria-invalid when not invalid', () => {
		const { container } = render(<Input id="i1" name="email" value="" onChange={vi.fn()} />)
		expect(within(container).getByRole('textbox')).not.toHaveAttribute('aria-invalid')
	})

	it('sets aria-describedby', () => {
		const { container } = render(
			<Input id="i1" name="email" value="" onChange={vi.fn()} describedById="i1-desc" />
		)
		expect(within(container).getByRole('textbox')).toHaveAttribute('aria-describedby', 'i1-desc')
	})
})

describe('Textarea', () => {
	it('renders with the given value', () => {
		const { container } = render(
			<Textarea id="t1" name="bio" value="some text" onChange={vi.fn()} />
		)
		expect(within(container).getByRole('textbox')).toHaveValue('some text')
	})

	it('calls onChange with the new string value', () => {
		const onChange = vi.fn()
		const { container } = render(<Textarea id="t1" name="bio" value="" onChange={onChange} />)
		fireEvent.change(within(container).getByRole('textbox'), { target: { value: 'hi' } })
		expect(onChange).toHaveBeenCalledWith('hi')
	})

	it('sets aria-invalid when invalid', () => {
		const { container } = render(
			<Textarea id="t1" name="bio" value="" onChange={vi.fn()} invalid />
		)
		expect(within(container).getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
	})

	it('omits aria-invalid when not invalid', () => {
		const { container } = render(<Textarea id="t1" name="bio" value="" onChange={vi.fn()} />)
		expect(within(container).getByRole('textbox')).not.toHaveAttribute('aria-invalid')
	})

	it('sets aria-describedby', () => {
		const { container } = render(
			<Textarea id="t1" name="bio" value="" onChange={vi.fn()} describedById="t1-desc" />
		)
		expect(within(container).getByRole('textbox')).toHaveAttribute('aria-describedby', 't1-desc')
	})
})

describe('Select', () => {
	const options = [
		{ label: 'Option A', value: 'a' },
		{ label: 'Option B', value: 'b' },
	]

	it('renders all options', () => {
		render(<Select id="s1" name="choice" value="a" options={options} onChange={vi.fn()} />)
		expect(screen.getByRole('combobox')).toBeInTheDocument()
		expect(screen.getByRole('option', { name: 'Option A' })).toBeInTheDocument()
		expect(screen.getByRole('option', { name: 'Option B' })).toBeInTheDocument()
	})

	it('reflects the current value', () => {
		render(<Select id="s1" name="choice" value="b" options={options} onChange={vi.fn()} />)
		expect(screen.getByRole('combobox')).toHaveValue('b')
	})

	it('calls onChange with the selected value', () => {
		const onChange = vi.fn()
		render(<Select id="s1" name="choice" value="a" options={options} onChange={onChange} />)
		fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
		expect(onChange).toHaveBeenCalledWith('b')
	})

	it('renders a placeholder option when given', () => {
		render(
			<Select
				id="s1"
				name="choice"
				value=""
				options={options}
				onChange={vi.fn()}
				placeholder="Pick one"
			/>
		)
		expect(screen.getByRole('option', { name: 'Pick one' })).toHaveValue('')
	})

	it('sets aria-invalid when invalid', () => {
		render(<Select id="s1" name="choice" value="" options={options} onChange={vi.fn()} invalid />)
		expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
	})

	it('omits aria-invalid when not invalid', () => {
		render(<Select id="s1" name="choice" value="" options={options} onChange={vi.fn()} />)
		expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid')
	})

	it('sets aria-describedby', () => {
		render(
			<Select
				id="s1"
				name="choice"
				value=""
				options={options}
				onChange={vi.fn()}
				describedById="s1-desc"
			/>
		)
		expect(screen.getByRole('combobox')).toHaveAttribute('aria-describedby', 's1-desc')
	})
})

describe('Checkbox', () => {
	it('renders unchecked by default when checked=false', () => {
		render(<Checkbox id="c1" name="agree" checked={false} onChange={vi.fn()} />)
		expect(screen.getByRole('checkbox')).not.toBeChecked()
	})

	it('reflects checked=true', () => {
		render(<Checkbox id="c1" name="agree" checked={true} onChange={vi.fn()} />)
		expect(screen.getByRole('checkbox')).toBeChecked()
	})

	it('calls onChange(true) when clicking an unchecked checkbox', () => {
		const onChange = vi.fn()
		render(<Checkbox id="c1" name="agree" checked={false} onChange={onChange} />)
		fireEvent.click(screen.getByRole('checkbox'))
		expect(onChange).toHaveBeenCalledWith(true)
	})

	it('calls onChange(false) when clicking a checked checkbox', () => {
		const onChange = vi.fn()
		render(<Checkbox id="c1" name="agree" checked={true} onChange={onChange} />)
		fireEvent.click(screen.getByRole('checkbox'))
		expect(onChange).toHaveBeenCalledWith(false)
	})

	it('sets aria-invalid when invalid', () => {
		render(<Checkbox id="c1" name="agree" checked={false} onChange={vi.fn()} invalid />)
		expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true')
	})

	it('omits aria-invalid when not invalid', () => {
		render(<Checkbox id="c1" name="agree" checked={false} onChange={vi.fn()} />)
		expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-invalid')
	})

	it('sets aria-describedby', () => {
		render(
			<Checkbox id="c1" name="agree" checked={false} onChange={vi.fn()} describedById="c1-desc" />
		)
		expect(screen.getByRole('checkbox')).toHaveAttribute('aria-describedby', 'c1-desc')
	})
})
