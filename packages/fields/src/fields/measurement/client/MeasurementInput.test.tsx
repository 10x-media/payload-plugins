// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// No useField in this mock: rendering at all proves the input needs no form behind it
vi.mock('@payloadcms/ui', () => ({
	FieldDescription: () => null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's FieldError surface
	FieldError: ({ message, showError }: any) =>
		showError && message ? <span data-testid="error">{message}</span> : null,
	FieldLabel: () => null,
	Popup: () => null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's RenderCustomComponent surface
	RenderCustomComponent: ({ CustomComponent, Fallback }: any) => CustomComponent ?? Fallback,
	fieldBaseClass: 'field-type',
}))
vi.mock('../../../translations/useTranslation', () => ({
	useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}))
vi.mock('./MeasurementUnitsProvider', () => ({ useMeasurementUnits: () => null }))

const { MeasurementInput } = await import('./MeasurementInput')

describe('MeasurementInput', () => {
	afterEach(cleanup)

	it('converts typed display-unit input back to the storage unit', () => {
		const onChange = vi.fn()
		const { container } = render(
			<MeasurementInput
				onChange={onChange}
				options={{ fallbackUnit: 'm', storageUnit: 'cm', units: ['cm', 'm'] }}
				value={null}
			/>
		)
		const input = container.querySelector('input') as HTMLInputElement
		fireEvent.change(input, { target: { value: '1.5' } })
		expect(onChange).toHaveBeenLastCalledWith(150)
	})

	it('defaults units and preference bucket from the storage unit alone', () => {
		const { container } = render(
			<MeasurementInput onChange={() => {}} options={{ storageUnit: 'kg' }} value={2} />
		)
		const input = container.querySelector('input') as HTMLInputElement
		expect(Number(input.value)).toBeGreaterThan(0)
	})

	it('settles with a fresh inline options object on every render', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const renderInput = () => (
			<MeasurementInput
				onChange={() => {}}
				options={{ fallbackUnit: 'kg', precision: 'exact', storageUnit: 'kg', units: ['kg'] }}
				value={81.646627}
			/>
		)
		const { rerender } = render(renderInput())
		rerender(renderInput())
		const loopErrors = errorSpy.mock.calls.filter((call) =>
			call.some((arg) => typeof arg === 'string' && arg.includes('Maximum update depth exceeded'))
		)
		expect(loopErrors).toHaveLength(0)
		errorSpy.mockRestore()
	})

	it('reports its own bound error when no error state is passed', () => {
		const { getByTestId } = render(
			<MeasurementInput
				min={10}
				onChange={() => {}}
				options={{ fallbackUnit: 'cm', storageUnit: 'cm', units: ['cm'] }}
				value={5}
			/>
		)
		expect(getByTestId('error').textContent).toBe('fields:measurementBelowMin')
	})

	it('defers to a caller-controlled error state', () => {
		const { queryByTestId } = render(
			<MeasurementInput
				min={10}
				onChange={() => {}}
				options={{ fallbackUnit: 'cm', storageUnit: 'cm', units: ['cm'] }}
				showError={false}
				value={5}
			/>
		)
		expect(queryByTestId('error')).toBeNull()
	})
})
