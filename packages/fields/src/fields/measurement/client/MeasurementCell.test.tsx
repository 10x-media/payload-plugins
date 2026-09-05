// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockContext } = vi.hoisted(() => ({
	mockContext: vi.fn<() => unknown>(() => null),
}))

vi.mock('../../../translations/useTranslation', () => ({
	useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}))
vi.mock('./MeasurementUnitsProvider', () => ({ useMeasurementUnits: () => mockContext() }))

const { MeasurementCell } = await import('./MeasurementCell')

const options = {
	dimension: 'mass',
	preferenceKey: 'bodyWeight',
	storageUnit: 'kg',
	units: ['kg', 'lb', 'st-lb'],
} as const

describe('MeasurementCell', () => {
	afterEach(() => {
		cleanup()
	})
	it('renders nothing for non-numeric data', () => {
		const { container } = render(
			<MeasurementCell
				cellData={undefined}
				measurementOptions={{ ...options, units: [...options.units] }}
				// biome-ignore lint/suspicious/noExplicitAny: test spread of empty object
				{...({} as any)}
			/>
		)
		expect(container.textContent).toBe('')
	})
	it('formats in the fallback unit without a provider', () => {
		render(
			<MeasurementCell
				cellData={81.646627}
				measurementOptions={{ ...options, units: [...options.units] }}
				// biome-ignore lint/suspicious/noExplicitAny: test spread of empty object
				{...({} as any)}
			/>
		)
		expect(screen.getByText(/81\.6\s?kg/)).toBeDefined()
	})
	it('formats a custom unit through the field engine', () => {
		render(
			<MeasurementCell
				cellData={3704}
				measurementOptions={{
					custom: {
						units: {
							nmi: { dimension: 'length', factor: 1852, intlUnit: null, shortLabel: 'nmi' },
						},
					},
					dimension: 'length',
					fallbackUnit: 'nmi',
					preferenceKey: 'seaDistance',
					storageUnit: 'm',
					units: ['m', 'nmi'],
				}}
				// biome-ignore lint/suspicious/noExplicitAny: test spread of empty object
				{...({} as any)}
			/>
		)
		expect(screen.getByText('2 nmi')).toBeDefined()
	})
	it('formats in the context unit when the provider has one', () => {
		mockContext.mockReturnValueOnce({ ready: true, setUnit: () => {}, units: { bodyWeight: 'lb' } })
		render(
			<MeasurementCell
				cellData={81.646627}
				measurementOptions={{ ...options, units: [...options.units] }}
				// biome-ignore lint/suspicious/noExplicitAny: test spread of empty object
				{...({} as any)}
			/>
		)
		expect(screen.getByText(/180\s?lb/)).toBeDefined()
	})
})
