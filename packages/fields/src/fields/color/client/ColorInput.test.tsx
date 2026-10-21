// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No useField in this mock: rendering at all proves the input needs no form behind it
vi.mock('@payloadcms/ui', () => ({
	FieldDescription: () => null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's FieldError surface
	FieldError: ({ message, showError }: any) =>
		showError && message ? <span data-testid="error">{message}</span> : null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's FieldLabel surface
	FieldLabel: ({ htmlFor, label }: any) => <label htmlFor={htmlFor}>{label}</label>,
	Popup: () => null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's RenderCustomComponent surface
	RenderCustomComponent: ({ CustomComponent, Fallback }: any) => CustomComponent ?? Fallback,
	XIcon: () => null,
	fieldBaseClass: 'field-type',
}))
vi.mock('../../../translations/useTranslation', () => ({
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

class ResizeObserverStub {
	observe() {}
	disconnect() {}
}

const { ColorInput } = await import('./ColorInput')

describe('ColorInput', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	})
	afterEach(() => {
		cleanup()
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it('commits typed input normalized to the format after the debounce', () => {
		const onChange = vi.fn()
		const { container } = render(<ColorInput onChange={onChange} value={null} />)
		const input = container.querySelector('input') as HTMLInputElement
		fireEvent.change(input, { target: { value: 'rgb(255, 0, 0)' } })
		expect(onChange).not.toHaveBeenCalled()
		act(() => {
			vi.advanceTimersByTime(250)
		})
		expect(onChange).toHaveBeenLastCalledWith('#ff0000')
	})

	it('honors the stored format option', () => {
		const onChange = vi.fn()
		const { container } = render(
			<ColorInput onChange={onChange} options={{ format: 'rgb' }} value={null} />
		)
		const input = container.querySelector('input') as HTMLInputElement
		fireEvent.change(input, { target: { value: '#00ff00' } })
		fireEvent.blur(input)
		expect(onChange).toHaveBeenLastCalledWith('rgb(0 255 0)')
	})

	it('reports its own malformed-color error when no error state is passed', () => {
		const { getByTestId } = render(<ColorInput onChange={() => {}} value="nope" />)
		expect(getByTestId('error').textContent).toBe('fields:invalidColor')
	})

	it('defers to a caller-controlled error state', () => {
		const { queryByTestId } = render(
			<ColorInput onChange={() => {}} showError={false} value="nope" />
		)
		expect(queryByTestId('error')).toBeNull()
	})

	it('pairs the label with the input when no path is given', () => {
		const { container } = render(<ColorInput label="Accent" onChange={() => {}} value={null} />)
		const label = container.querySelector('label') as HTMLLabelElement
		const input = container.querySelector('input') as HTMLInputElement
		expect(label.htmlFor).not.toBe('')
		expect(label.htmlFor).toBe(input.id)
	})

	it('reverts an emptied non-clearable value to the last valid one on blur', () => {
		const onChange = vi.fn()
		const { container } = render(
			<ColorInput onChange={onChange} options={{ isClearable: false }} value="#123456" />
		)
		const input = container.querySelector('input') as HTMLInputElement
		fireEvent.change(input, { target: { value: '' } })
		fireEvent.blur(input)
		expect(onChange).toHaveBeenLastCalledWith('#123456')
		expect(input.value).toBe('#123456')
	})
})
