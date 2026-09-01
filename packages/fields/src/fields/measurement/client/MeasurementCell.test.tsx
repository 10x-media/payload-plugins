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

const options = { storageUnit: 'kg', units: ['kg', 'lb', 'st-lb'], usage: 'bodyWeight' } as const

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
