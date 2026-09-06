// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultEngine } from '../engine/registry'
import { commitDrafts, draftsFor } from './editModel'

const fieldState = vi.hoisted(() => ({
	current: {
		customComponents: {},
		disabled: false,
		path: 'height',
		setValue: vi.fn(),
		showError: false,
		value: null as number | null,
	},
}))

vi.mock('payload/shared', () => ({ number: () => true }))
vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: () => ({}) }))
vi.mock('@payloadcms/ui', () => ({
	FieldDescription: () => null,
	FieldError: () => null,
	FieldLabel: () => null,
	Popup: () => null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's RenderCustomComponent surface
	RenderCustomComponent: ({ CustomComponent, Fallback }: any) => CustomComponent ?? Fallback,
	fieldBaseClass: 'field-type',
	useField: () => fieldState.current,
}))
vi.mock('../../../translations/useTranslation', () => ({
	useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}))
vi.mock('./MeasurementUnitsProvider', () => ({ useMeasurementUnits: () => null }))

const { MeasurementField } = await import('./MeasurementField')

const baseField = { admin: {}, localized: false, name: 'height', required: false } as never

describe('MeasurementField', () => {
	afterEach(() => {
		cleanup()
		fieldState.current = {
			customComponents: {},
			disabled: false,
			path: 'height',
			setValue: vi.fn(),
			showError: false,
			value: null,
		}
	})

	it('settles without an update-depth loop in exact mode (unmemoized precision override regression)', () => {
		fieldState.current = { ...fieldState.current, path: 'weight', value: 81.646627 }
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const measurementOptions = {
			dimension: 'mass',
			fallbackUnit: 'kg',
			precision: { draft: 'faithful', entry: 'free', mode: 'exact', storage: 6 },
			preferenceKey: 'weight',
			storageUnit: 'kg',
			units: ['kg'],
		} as never
		render(
			<MeasurementField
				field={baseField}
				measurementOptions={measurementOptions}
				path="weight"
				// biome-ignore lint/suspicious/noExplicitAny: test spread of unused NumberFieldClientProps
				{...({} as any)}
			/>
		)
		const loopErrors = errorSpy.mock.calls.filter((call) =>
			call.some((arg) => typeof arg === 'string' && arg.includes('Maximum update depth exceeded'))
		)
		expect(loopErrors).toHaveLength(0)
		errorSpy.mockRestore()
	})

	it('freezes the delta baseline across sequential keystrokes on the same part (no double-application)', () => {
		const stored = 182.5
		fieldState.current = { ...fieldState.current, path: 'height', value: stored }
		const measurementOptions = {
			dimension: 'length',
			fallbackUnit: 'ft-in',
			preferenceKey: 'height',
			storageUnit: 'cm',
			units: ['cm', 'in', 'ft-in'],
		} as never
		const { container, rerender } = render(
			<MeasurementField
				field={baseField}
				measurementOptions={measurementOptions}
				path="height"
				// biome-ignore lint/suspicious/noExplicitAny: test spread of unused NumberFieldClientProps
				{...({} as any)}
			/>
		)
		const rerenderField = () =>
			rerender(
				<MeasurementField
					field={baseField}
					measurementOptions={measurementOptions}
					path="height"
					// biome-ignore lint/suspicious/noExplicitAny: test spread of unused NumberFieldClientProps
					{...({} as any)}
				/>
			)
		const inputs = container.querySelectorAll('input')
		const primaryInput = inputs[0] as HTMLInputElement

		// Stored 182.5 cm carries to a painted "6 ft 0 in" (exact split is 5 ft 11.850394 in).
		fireEvent.change(primaryInput, { target: { value: '7' } })
		const firstCommit = fieldState.current.setValue.mock.calls.at(-1)?.[0] as number

		// Payload's form applies the write and re-renders with the advanced value, same as
		// a real save-in-place would, while the viewer is still mid-edit (no blur yet).
		fieldState.current = { ...fieldState.current, value: firstCommit }
		rerenderField()
		fireEvent.change(primaryInput, { target: { value: '75' } })
		const secondCommit = fieldState.current.setValue.mock.calls.at(-1)?.[0] as number

		const painted = draftsFor(stored, {
			displayUnit: 'ft-in',
			draft: 'display',
			engine: defaultEngine,
			storageUnit: 'cm',
		})
		const singleShot = commitDrafts(
			{ minor: painted.minor, primary: '75' },
			{
				dirty: { minor: false, primary: true },
				displayUnit: 'ft-in',
				engine: defaultEngine,
				paintedDrafts: painted,
				storageUnit: 'cm',
				storedValue: stored,
			}
		)

		expect(secondCommit).toBe(singleShot)
		expect(secondCommit).not.toBe(firstCommit)
	})

	it('focuses the input when the passive unit suffix is clicked', () => {
		fieldState.current = { ...fieldState.current, path: 'weight', value: 81.646627 }
		const measurementOptions = {
			dimension: 'mass',
			fallbackUnit: 'kg',
			preferenceKey: 'weight',
			storageUnit: 'kg',
			units: ['kg'],
		} as never
		const { container } = render(
			<MeasurementField
				field={baseField}
				measurementOptions={measurementOptions}
				path="weight"
				// biome-ignore lint/suspicious/noExplicitAny: test spread of unused NumberFieldClientProps
				{...({} as any)}
			/>
		)
		const suffix = container.querySelector('.fields-measurement__unit-static')
		const input = container.querySelector('input')
		expect(suffix).not.toBeNull()
		fireEvent.mouseDown(suffix as Element)
		expect(document.activeElement).toBe(input)
	})
})
